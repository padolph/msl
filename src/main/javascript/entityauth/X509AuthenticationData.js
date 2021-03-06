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
 * <p>X.509 asymmetric keys entity authentication data.</p>
 *
 * <p>The X.509 certificate should be used to enumerate any entity
 * properties. The certificate subject canonical name is considered the device
 * identity. X.509 authentication data is considered equal based on the device
 * identity.</p>
 *
 * <p>
 * {@code {
 *   "#mandatory" : [ "x509certificate" ],
 *   "x509certificate" : "base64"
 * }} where:
 * <ul>
 * <li>{@code x509certificate} is Base64-encoded X.509 certificate</li>
 * </ul></p>
 *
 * @author Wesley Miaw <wmiaw@netflix.com>
 */
var X509AuthenticationData;
var X509AuthenticationData$parse;

(function() {
    /**
     * JSON key entity X.509 certificate.
     * @const
     * @type {string}
     */
    var KEY_X509_CERT = "x509certificate";

    X509AuthenticationData = EntityAuthenticationData.extend({
        /**
         * <p>Construct a new X.509 asymmetric keys authentication data instance from
         * the provided X.509 certificate.</p>
         *
         * @param {X509} x509cert entity X.509 certificate.
         * @throws MslCryptoException if the X.509 certificate data cannot be
         *         parsed.
         */
        init: function init(x509cert) {
            init.base.call(this, EntityAuthenticationScheme.X509);

            var identity = x509cert.getSubjectString();

            // The properties.
            var props = {
                identity: { value: identity, writable: false, configurable: false },
                x509cert: { value: x509cert, writable: false, configurable: false },
            };
            Object.defineProperties(this, props);
        },

        /** @inheritDoc */
        getIdentity: function getIdentity() {
            return this.identity;
        },

        /** @inheritDoc */
        getAuthData: function getAuthData() {
            // Base64 encode the X.509 certificate.
            var certHex = this.x509cert.hex;
            var certWords = CryptoJS.enc.Hex.parse(certHex);
            var certB64 = CryptoJS.enc.Base64.stringify(certWords);

            // Return the authentication data.
            var result = {};
            result[KEY_X509_CERT] = certB64;
            return result;
        },

        /** @inheritDoc */
        equals: function equals(that) {
            if (this === that) return true;
            if (!(that instanceof X509AuthenticationData)) return false;
            return (equals.base.call(this, that) && this.identity == that.identity);
        },
    });

    /**
     * Construct a new RSA asymmetric keys authentication data instance from the
     * provided JSON object.
     *
     * @param x509AuthJO the authentication data JSON object.
     * @throws MslEncodingException if there is an error parsing the entity
     *         authentication data.
     */
    X509AuthenticationData$parse = function X509AuthenticationData$parse(x509AuthJO) {
        var certB64 = x509AuthJO[KEY_X509_CERT];

        if (typeof certB64 !== 'string')
            throw new MslEncodingException(MslError.JSON_PARSE_ERROR, "X.509 authdata" + JSON.stringify(x509AuthJO));

        // Convert to X.509 certificate.
        var x509 = new X509();
        try {
            x509 = new X509();
            x509.readCertPEM(certB64);
        } catch (e) {
            throw new MslCryptoException(MslError.X509CERT_PARSE_ERROR, certB64, e);
        }
        return new X509AuthenticationData(x509);
    };
})();
