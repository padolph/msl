/**
 * Copyright (c) 2012-2014 Netflix, Inc.  All rights reserved.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * <p>A MSL message consists of a single MSL header followed by one or more
 * payload chunks carrying application data. Each payload chunk is individually
 * packaged but sequentially ordered. The end of the message is indicated by a
 * payload with no data.</p>
 *
 * <p>No payload chunks may be included in an error message.</p>
 *
 * <p>Data is buffered until {@link #flush()} or {@link #close()} is called.
 * At that point a new payload chunk is created and written out. Closing a
 * {@code MessageOutputStream} does not close the destination output stream in
 * case additional MSL messages will be written.</p>
 * 
 * <p>A copy of the payload chunks is kept in-memory and can be retrieved by a
 * a call to {@code getPayloads()} until {@code stopCaching()} is called. This
 * is used to facilitate automatic re-sending of messages.</p>
 *
 * @author Wesley Miaw <wmiaw@netflix.com>
 */
var MessageOutputStream;
var MessageOutputStream$create;

(function() {
    "use strict";
    
    MessageOutputStream = OutputStream.extend({
        /**
         * Construct a new message output stream. The header is output
         * immediately by calling {@code #flush()} on the destination output
         * stream. The most preferred compression algorithm supported by the
         * local entity and message header will be used.
         *
         * @param {MslContext} ctx the MSL context.
         * @param {OutputStream} destination MSL output stream.
         * @param {string} charset output stream character set encoding.
         * @param {MessageHeader|ErrorHeader} header message or error header.
         * @param {?ICryptoContext} cryptoContext payload data crypto context.
         *        Required if a message header is provided.
         * @param {number} timeout write timeout in milliseconds.
         * @param {{result: function(MessageOutputStream), timeout: function(), error: function(Error)}}
         *        callback the callback that will receive the message output
         *        stream, or any thrown exceptions.
         * @throws IOException if there is an error writing the header.
         */
        init: function init(ctx, destination, charset, header, cryptoContext, timeout, callback) {
            var self = this;
            InterruptibleExecutor(callback, function() {
                // The supported compression algorithms is the intersection of what the
                // local entity supports and what the remote entity supports.
                var capabilities = MessageCapabilities$intersection(ctx.getMessageCapabilities(), header.messageCapabilities);
                var compressionAlgo = null;
                if (capabilities) {
                    var compressionAlgos = capabilities.compressionAlgorithms;
                    compressionAlgo = MslConstants$CompressionAlgorithm$getPreferredAlgorithm(compressionAlgos);
                }
                
                // Set properties.
                var props = {
                    _destination: { value: destination, writable: false, enumerable: false, configurable: false },
                    _charset: { value: charset, writable: false, enumerable: false, configurable: false },
                    _capabilities : { value: capabilities, writable: false, enumerable: false, configurable: false },
                    _header: { value: header, writable: false, enumerable: false, configurable: false },
                    _compressionAlgo: { value: compressionAlgo, writable: true, enumerable: false, configurable: false },
                    _cryptoContext: { value: cryptoContext, writable: false, enumerable: false, configurable: false },
                    _payloadSequenceNumber: { value: 1, writable: true, enumerable: false, configurable: false },
                    /** @type {Array.<Uint8Array>} */
                    _currentPayload: { value: new Array(), writable: true, enumerable: false, configurable: false },
                    /** @type {boolean} */
                    _closed: { value: false, writable: true, enumerable: false, configurable: false },
                    /** @type {boolean} */
                    _closeDestination: { value: false, writable: true, enuemrable: false, configurable: false },
                    /** @type {boolean} */
                    _caching: { value: true, writable: true, enumerable: false, configurable: false },
                    /** @type {Array.<PayloadChunk>} */
                    _payloads: { value: new Array(), writable: false, enumerable: false, configurable: false },
                    // Set true once the header has been sent and payloads may
                    // be written.
                    _ready: { value: false, writable: true, enumerable: false, configurable: false },
                    // Use a blocking queue as a semaphore.
                    _readyQueue: { value: new BlockingQueue(), writable: false, enumerable: false, configurable: false },
                    _aborted: { value: false, writable: true, enumerable: false, configurable: false },
                    // If timed out writing the header then deliver the timeout
                    // at the next operation.
                    _timedout: { value: false, writable: true, enumerable: false, configurable: false },
                    // If an error occurs while writing the header then deliver
                    // it at the next operation.
                    _errored: { value: null, writable: true, enumerable: false, configurable: false },
                };
                Object.defineProperties(this, props);

                function ready() {
                    self._ready = true;
                    self._readyQueue.add(true);
                }

                var headerBytes = textEncoding$getBytes(JSON.stringify(header), charset);
                destination.write(headerBytes, 0, headerBytes.length, timeout, {
                    result: function(numWritten) {
                        try {
                            // If aborted do nothing.
                            if (self._aborted) {
                                ready();
                                return;
                            }

                            // Check if timed out.
                            if (numWritten < headerBytes.length) {
                                self._timedout = true;
                                ready();
                                return;
                            }
                            destination.flush(timeout, {
                                result: function(success) {
                                    // If aborted do nothing.
                                    if (self._aborted) {
                                        ready();
                                        return;
                                    }
                                    self._timedout = !success;

                                    // Notify all that it is ready.
                                    ready();
                                },
                                timeout: function() {
                                    self._timedout = true;
                                    ready();
                                },
                                error: function(e) {
                                    self._errored = e;
                                    ready();
                                }
                            });
                        } catch (e) {
                            self._errored = e;
                            ready();
                        }
                    },
                    timeout: function() {
                        self._timedout = true;
                        ready();
                    },
                    error: function(e) {
                        self._errored = e;
                        ready();
                    }
                });

                // Return this immediately instead of after writing the header
                // so the write can be aborted.
                return this;
            }, self);
        },

        /**
         * Set the payload chunk compression algorithm that will be used for all
         * future payload chunks. This function will flush any buffered data iff
         * the compression algorithm is being changed.
         *
         * @param {MslConstants$CompressionAlgorithm} compressionAlgo payload chunk
         *            compression algorithm. Null for no compression.
         * @param {number} timeout write timeout in milliseconds.
         * @param {{result: function(boolean), timeout: function(), error: function(Error)}}
         *        callback the callback that will receive true if the
         *        compression algorithm is supported by the message, false if
         *        it is not, or any thrown exceptions.
         * @throws IOException if buffered data could not be flushed. The
         *         compression algorithm will be unchanged.
         * @throws MslInternalException if writing an error message.
         * @see #flush()
         */
        setCompressionAlgorithm: function setCompressionAlgorithm(compressionAlgo, timeout, callback) {
            var self = this;
            InterruptibleExecutor(callback, function() {
                // Make sure this is not an error message,
                var messageHeader = this.getMessageHeader();
                if (!messageHeader)
                    throw new MslInternalException("Cannot write payload data for an error message.");

                // Do nothing if the compression algorithm is not different.
                if (this._compressionAlgo == compressionAlgo)
                    return true;
                
                // Make sure the message is capable of using the compression algorithm.
                if (compressionAlgo) {
                    if (!this._capabilities)
                        return false;
                    var compressionAlgos = this._capabilities.compressionAlgorithms;
                    for (var i = 0; i < compressionAlgos.length; ++i) {
                        if (compressionAlgos[i] == compressionAlgo) {
                            flush();
                            return;
                        }
                    }
                    return false;
                } else {
                    flush();
                    return;
                }
            }, self);
            
            function flush() {
                self.flush(timeout, {
                    result: function(success) {
                        InterruptibleExecutor(callback, function() {
                            // If unsuccessful deliver an error.
                            if (!success)
                                throw new MslIoException("flush() aborted");
                            this._compressionAlgo = compressionAlgo;
                            return true;
                        }, self);
                    },
                    timeout: function() { callback.timeout(); },
                    error: function(e) { callback.error(e); }
                });
            }
        },

        /**
         * @return {MessageHeader} the message header. Will be null for error messages.
         */
        getMessageHeader: function getMessageHeader() {
            if (this._header instanceof MessageHeader)
                return this._header;
            return null;
        },

        /**
         * @return {ErrorHeader} the error header. Will be null except for error messages.
         */
        getErrorMessage: function getErrorHeader() {
            if (this._header instanceof ErrorHeader)
                return this._header;
            return null;
        },

        /**
         * Returns the payloads sent so far. Once payload caching is turned off
         * this list will always be empty.
         * 
         * @return {Array.<PayloadChunk>} an ordered list of the payloads sent so far.
         */
        getPayloads: function getPayloads() {
            return this._payloads;
        },
        
        /**
         * Turns off caching of any message data (e.g. payloads).
         */
        stopCaching: function stopCaching() {
            this._caching = false;
            this._payloads.length = 0;
        },

        /** @inheritDoc */
        abort: function abort() {
            this._aborted = true;
            this._destination.abort();
            this._readyQueue.cancelAll();
        },
        
        /**
         * By default the destination output stream is not closed when this message
         * output stream is closed. If it should be closed then this method can be
         * used to dictate the desired behavior.
         * 
         * @param {boolean} close true if the destination output stream should be closed,
         *        false if it should not.
         */
        closeDestination: function closeDestination(close) {
            this._closeDestination = close;
        },

        /** @inheritDoc */
        close: function close(timeout, callback) {
            var self = this;

            InterruptibleExecutor(callback, function() {
                // Check if already aborted, timedout, or errored.
                if (this._aborted)
                    return false;
                if (this._timedout) {
                    callback.timeout();
                    return;
                }
                if (this._errored)
                    throw this._errored;

                if (this._closed) return true;

                // Send a final payload that can be used to identify the end of data.
                // This is done by setting closed equal to true while the current
                // payload not null.
                this._closed = true;
                this.flush(timeout, {
                    result: function(success) {
                        InterruptibleExecutor(callback, function() {
                            // If successful the payload is sent.
                            if (success)
                                this._currentPayload = null;

                            // Only close the destination if instructed to do so because we might
                            // want to reuse the connection.
                            if (this._closeDestination)
                                this._destination.close(timeout, callback);
                            else
                                return success;
                        }, self);
                    },
                    timeout: callback.timeout,
                    error: callback.error,
                });
            }, self);
        },

        /**
         * Flush any buffered data out to the destination. This creates a payload
         * chunk. If there is no buffered data or this is an error message this
         * function does nothing.
         *
         * @param {number} timeout write timeout in milliseconds.
         * @param {{result: function(boolean), timeout: function(), error: function(Error)}}
         *        callback the callback that will receive true upon completion
         *        or false if aborted, be notified of a timeout, or any thrown
         *        exceptions.
         * @throws IOException if buffered data could not be flushed.
         * @throws MslInternalException if writing an error message.
         * @see java.io.OutputStream#flush()
         */
        flush: function flush(timeout, callback) {
            var self = this;

            InterruptibleExecutor(callback, function() {
                // If not ready wait until we are ready.
                if (!this._ready) {
                    this._readyQueue.poll(timeout, {
                        result: function(elem) {
                            // If aborted return false.
                            if (elem === undefined) callback.result(false);
                            else perform();
                        },
                        timeout: function() { callback.timeout(); },
                        error: function(e) { callback.error(e); }
                    });
                } else {
                    perform();
                }
            }, self);

            function perform() {
                InterruptibleExecutor(callback, function() {
                    // Check if already aborted, timedout, or errored.
                    if (this._aborted)
                        return false;
                    if (this._timedout) {
                        callback.timeout();
                        return;
                    }
                    if (this._errored)
                        throw this._errored;

                    // If the current payload is null, we are already closed.
                    if (!this._currentPayload) return true;

                    // If we are not closed, and there is no data then we have nothing to
                    // send.
                    if (!this._closed && this._currentPayload.length == 0) return true;

                    // This is a no-op for error messages and handshake messages.
                    var messageHeader = this.getMessageHeader();
                    if (!messageHeader || messageHeader.isHandshake()) return true;

                    // Otherwise we are closed and need to send any buffered data as the
                    // last payload. If there is no buffered data, we still need to send a
                    // payload with the end of message flag set.
                    //
                    // Convert the current payload to a single Uint8Array.
                    var length = 0;
                    if (this._currentPayload)
                        this._currentPayload.forEach(function(segment) { length += segment.length; });
                    var data = new Uint8Array(length);
                    for (var offset = 0, i = 0; this._currentPayload && i < this._currentPayload.length; ++i) {
                        var segment = this._currentPayload[i];
                        data.set(segment, offset);
                        offset += segment.length;
                    }

                    // Write the payload chunk.
                    PayloadChunk$create(this._payloadSequenceNumber, messageHeader.messageId, this._closed, this._compressionAlgo, data, this._cryptoContext, {
                        result: function(chunk) {
                            InterruptibleExecutor(callback, function() {
                                if (this._caching) this._payloads.push(chunk);
                                var payloadBytes = textEncoding$getBytes(JSON.stringify(chunk), this._charset);
                                this._destination.write(payloadBytes, 0, payloadBytes.length, timeout, {
                                    result: function(numWritten) {
                                        InterruptibleExecutor(callback, function() {
                                            // If we were aborted then return false.
                                            if (this._aborted) return false;

                                            // If we timed out then notify the caller.
                                            if (numWritten < chunk.length) {
                                                callback.timeout();
                                                return;
                                            }

                                            this._destination.flush(timeout, {
                                                result: function(success) {
                                                    InterruptibleExecutor(callback, function() {
                                                        // If we were aborted then return false.
                                                        if (this._aborted) return false;

                                                        // If we timed out then return false.
                                                        if (!success) {
                                                            callback.timeout();
                                                            return;
                                                        }

                                                        // Increment the payload number.
                                                        ++this._payloadSequenceNumber;

                                                        // If we are closed, get rid of the current payload. This prevents
                                                        // us from sending any more payloads. Otherwise reset it for reuse.
                                                        if (this._closed)
                                                            this._currentPayload = null;
                                                        else
                                                            this._currentPayload = [];
                                                        return true;
                                                    }, self);
                                                },
                                                timeout: function() { callback.timeout(); },
                                                error: function(e) {
                                                    if (e instanceof MslException)
                                                        e = new MslIoException("Error encoding payload chunk [sequence number " + self._payloadSequenceNumber + "].", e);
                                                    callback.error(e);
                                                }
                                            });
                                        }, self);
                                    },
                                    timeout: function(numWritten) { callback.timeout(); },
                                    error: function(e) {
                                        if (e instanceof MslException)
                                            e = new MslIoException("Error encoding payload chunk [sequence number " + self._payloadSequenceNumber + "].", e);
                                        callback.error(e);
                                    }
                                });
                            }, self);
                        },
                        error: function(e) {
                            if (e instanceof MslException)
                                e = new MslIoException("Error encoding payload chunk [sequence number " + self._payloadSequenceNumber + "].", e);
                            callback.error(e);
                        }
                    });
                }, self);
            }
        },

        /* (non-Javadoc)
         * @see java.io.OutputStream#write(byte[], int, int)
         */
        write: function write(data, off, len, timeout, callback) {
            var self = this;

            InterruptibleExecutor(callback, function() {
                // Check if already aborted, timedout, or errored.
                if (this._aborted)
                    return false;
                if (this._timedout) {
                    callback.timeout();
                    return;
                }
                if (this._errored)
                    throw this._errored;

                // Fail if closed.
                if (this._closed)
                    throw new MslIoException("Message output stream already closed.");

                // Verify arguments.
                if (off < 0)
                    throw new RangeError("Offset cannot be negative.");
                if (len < 0)
                    throw new RangeError("Length cannot be negative.");
                if (off + len > data.length)
                    throw new RangeError("Offset plus length cannot be greater than the array length.");

                // Make sure this is not an error message or handshake message.
                var messageHeader = this.getMessageHeader();
                if (!messageHeader)
                    throw new MslInternalException("Cannot write payload data for an error message.");
                if (messageHeader.isHandshake())
                    throw new MslInternalException("Cannot write payload data for a handshake message.");

                // Append data.
                var bytes = data.subarray(off, off + len);
                this._currentPayload.push(bytes);
                return bytes.length;
            }, self);
        },
    });


    /**
     * Construct a new message output stream. The header is output
     * immediately by calling {@code #flush()} on the destination output
     * stream. The most preferred compression algorithm supported by the
     * local entity and message header will be used.
     *
     * @param {MslContext} ctx the MSL context.
     * @param {OutputStream} destination MSL output stream.
     * @param {string} charset output stream character set encoding.
     * @param {MessageHeader|ErrorHeader} header message or error header.
     * @param {?ICryptoContext} cryptoContext payload data crypto context.
     *        Required if a message header is provided.
     * @param {number} timeout write timeout in milliseconds.
     * @param {{result: function(MessageOutputStream), timeout: function(), error: function(Error)}}
     *        callback the callback that will receive the message output
     *        stream, or any thrown exceptions.
     * @throws IOException if there is an error writing the header.
     */
    MessageOutputStream$create = function MessageOutputStream$create(ctx, destination, charset, header, cryptoContext, timeout, callback) {
        new MessageOutputStream(ctx, destination, charset, header, cryptoContext, timeout, callback);
    };
})();
