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
 * Preshared keys entity authentication data unit tests.
 * 
 * @author Wesley Miaw <wmiaw@netflix.com>
 */
describe("PresharedAuthenticationData", function() {
    /** JSON key entity authentication scheme. */
    var KEY_SCHEME = "scheme";
    /** JSON key entity authentication data. */
    var KEY_AUTHDATA = "authdata";
    /** JSON key entity identity. */
    var KEY_IDENTITY = "identity";

    /** MSL context. */
    var ctx;
    beforeEach(function() {
        if (!ctx) {
            runs(function() {
                MockMslContext$create(EntityAuthenticationScheme.X509, false, {
                    result: function(c) { ctx = c; },
                    error: function(e) { expect(function() { throw e; }).not.toThrow(); }
                });
            });
            waitsFor(function() { return ctx; }, "ctx", 100);
        }
    });

    it("ctors", function() {
        var data = new PresharedAuthenticationData(MockPresharedAuthenticationFactory.PSK_ESN);
        expect(data.identity).toEqual(MockPresharedAuthenticationFactory.PSK_ESN);
        expect(data.scheme).toEqual(EntityAuthenticationScheme.PSK);
        var authdata = data.getAuthData();
        expect(authdata).not.toBeNull();
        var jsonString = JSON.stringify(data);
        expect(jsonString).not.toBeNull();
        
        var joData = PresharedAuthenticationData$parse(authdata);
        expect(joData.identity).toEqual(data.identity);
        expect(joData.scheme).toEqual(data.scheme);
        var joAuthdata = joData.getAuthData();
        expect(joAuthdata).not.toBeNull();
        expect(joAuthdata).toEqual(authdata);
        var joJsonString = JSON.stringify(joData);
        expect(joJsonString).not.toBeNull();
        expect(joJsonString).toEqual(jsonString);
    });
    
    it("json is correct", function() {
        var data = new PresharedAuthenticationData(MockPresharedAuthenticationFactory.PSK_ESN);
        var jo = JSON.parse(JSON.stringify(data));
        expect(jo[KEY_SCHEME]).toEqual(EntityAuthenticationScheme.PSK.name);
        var authdata = jo[KEY_AUTHDATA];
        expect(authdata[KEY_IDENTITY]).toEqual(MockPresharedAuthenticationFactory.PSK_ESN);
    });
    
    it("create", function() {
        var data = new PresharedAuthenticationData(MockPresharedAuthenticationFactory.PSK_ESN);
        var jsonString = JSON.stringify(data);
        var jo = JSON.parse(jsonString);
        var entitydata = EntityAuthenticationData$parse(ctx, jo);
        expect(entitydata).not.toBeNull();
        expect(entitydata instanceof PresharedAuthenticationData).toBeTruthy();
        
        var joData = entitydata;
        expect(joData.identity).toEqual(data.identity);
        expect(joData.scheme).toEqual(data.scheme);
        var joAuthdata = joData.getAuthData();
        expect(joAuthdata).not.toBeNull();
        expect(joAuthdata).toEqual(data.getAuthData());
        var joJsonString = JSON.stringify(joData);
        expect(joJsonString).not.toBeNull();
        expect(joJsonString).toEqual(jsonString);
    });
    
    it("missing identity", function() {
    	var f = function() {
	        var data = new PresharedAuthenticationData(MockPresharedAuthenticationFactory.PSK_ESN);
	        var authdata = data.getAuthData();
	        delete authdata[KEY_IDENTITY];
	        PresharedAuthenticationData$parse(authdata);
    	};
    	expect(f).toThrow(new MslEncodingException(MslError.JSON_PARSE_ERROR));
    });

    it("equals identity", function() {
        var identityA = MockPresharedAuthenticationFactory.PSK_ESN + "A";
        var identityB = MockPresharedAuthenticationFactory.PSK_ESN + "B";
        var dataA = new PresharedAuthenticationData(identityA);
        var dataB = new PresharedAuthenticationData(identityB);
        var dataA2 = EntityAuthenticationData$parse(ctx, JSON.parse(JSON.stringify(dataA)));
        
        expect(dataA.equals(dataA)).toBeTruthy();
        
        expect(dataA.equals(dataB)).toBeFalsy();
        expect(dataB.equals(dataA)).toBeFalsy();
        
        expect(dataA.equals(dataA2)).toBeTruthy();
        expect(dataA2.equals(dataA)).toBeTruthy();
    });
    
    it("equals object", function() {
        var data = new PresharedAuthenticationData(MockPresharedAuthenticationFactory.PSK_ESN);
        expect(data.equals(null)).toBeFalsy();
        expect(data.equals(KEY_IDENTITY)).toBeFalsy();
    });
});
