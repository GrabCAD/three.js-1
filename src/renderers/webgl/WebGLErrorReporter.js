class  WebGLErrorReporter {

	constructor( gl ) {

		const _this = this;
		const _gl = gl;

		// Don't copy the width and height fields since they are volatile and the copies won't update.
		// use the exposed gl instead.
		// Expose the underlying context, it's needed in a few special cases
		this.gl = _gl;

		this.canvas = _gl.canvas;
		var _enabledCount = 1;

		this.debugDisableChecking = function () {
			_enabledCount--;
		};

		this.debugEnableChecking = function () {
			_enabledCount++;
		};

		function checkGlError( functionName ) {
			if (_enabledCount <= 0)
				return;

			var errText = 'unknown';
			const err = _gl.getError();
			if ( err === _gl.NO_ERROR )
				return;
			else if ( err === _gl.INVALID_ENUM )
				errText = 'Invalid Enum';
			else if ( err === _gl.INVALID_VALUE )
				errText = 'Invalid value';
			else if ( err === _gl.INVALID_OPERATION )
				errText = 'Invalid operation';
			else if ( err === _gl.INVALID_FRAMEBUFFER_OPERATION )
				errText = 'Invalid framebuffer operation';
			else if ( err === _gl.OUT_OF_MEMORY )
				errText = 'Out of memory';
			else if ( err === _gl.CONTEXT_LOST_WEBGL )
				errText = 'Lost webgl context';

			console.warn( 'Error "' +  errText + '" when calling gl.' + functionName + '(...).' );

		}

		function testWithCheck(item, itemName, args) {

			const result = item.apply(_gl, args);
			checkGlError(itemName);
			return result;

		}
		// Use introspection to populate the wrapper object.

		const protoPropNames = Object.getOwnPropertyNames( _gl.__proto__ );

		protoPropNames.forEach( function(itemName) {
			if (itemName === 'constructor' || !_gl.__proto__.hasOwnProperty(itemName))
				return;

			const item = _gl[itemName];
			if (typeof( item ) === 'function') {
				_this.__proto__[itemName] = function (...args) {
					return testWithCheck(item, itemName, args);
				}
			} else {
				_this.__proto__[itemName] = item;
			}
		});

	}
}

export { WebGLErrorReporter };
