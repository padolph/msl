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
describe("MslError", function() {
    var BASE = 100000;
    
    it("JSON parse error is correct", function() {
        expect(MslError.JSON_PARSE_ERROR).not.toBeUndefined();
        expect(MslError.JSON_PARSE_ERROR).not.toBeNull();
        expect(MslError.JSON_PARSE_ERROR.internalCode).toEqual(BASE);
        expect(MslError.JSON_PARSE_ERROR.responseCode).toEqual(MslConstants$ResponseCode.FAIL);
        expect(MslError.JSON_PARSE_ERROR.message).toEqual("Error parsing JSON.");
    });
    
    it("is immutable", function() {
    	MslError.JSON_PARSE_ERROR.internalCode = "x";
    	MslError.JSON_PARSE_ERROR.responseCode = "x";
    	MslError.JSON_PARSE_ERROR.message = "x";
        expect(MslError.JSON_PARSE_ERROR.internalCode).toEqual(BASE);
        expect(MslError.JSON_PARSE_ERROR.responseCode).toEqual(MslConstants$ResponseCode.FAIL);
        expect(MslError.JSON_PARSE_ERROR.message).toEqual("Error parsing JSON.");
    });
    
    it("no repeated internal codes", function() {
    	var internalCodes = [];
    	for (var element in MslError) {
    		if (MslError.hasOwnProperty(element)) {
    			var err = MslError[element];
    			if (internalCodes.indexOf(err.internalCode) != -1)
    			    console.log(element, err, err.internalCode);
    			expect(internalCodes.indexOf(err.internalCode)).toEqual(-1);
    			internalCodes.push(err.internalCode);
    		} 
    	}
    });
});