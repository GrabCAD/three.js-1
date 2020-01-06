/**
 * @author Robert Tipton
 */

function DPTestFlags () {
	return {
		drawFrontColor: 0,
		drawBackColor: 1,
		drawDepthNear: 2,
		drawDepthFar: 3,
		drawDepthBack: 4,
		drawBlendBack: 5,

		testModeDrawColor: 0,
		testModeDrawDepthNear: 1,
		testModeDrawDepthFar: 2,
		testModeDrawDepthBack: 3,

	};
}

class WebGLDPBuffers {
	constructor( renderer ) {
		const
			_this = this,
			_renderer = renderer,
			_gl = renderer.context,
			_state = renderer.state;

		var
			_bufferSize;

		function populateParams ( params ) {

			// Once an internal format is chosen, there is a table that determines the choice(es) for
			// the format and type. The table is located at
			// https://www.khronos.org/registry/webgl/specs/latest/2.0/#TEXTURE_TYPES_FORMATS_FROM_DOM_ELEMENTS_TABLE
			// This code assures that types are in agreement.

			if (params.internalFormat === _gl.RG32F ) {
				params.format = _gl.RG;
				params.type = _gl.FLOAT;
			} else if (params.internalFormat === _gl.RGB16F ) {
				params.format = _gl.RGB;
				params.type = _gl.HALF_FLOAT;
			} else if (params.internalFormat === _gl.RGB32F ) {
				params.format = _gl.RGB;
				params.type = _gl.FLOAT;
			} else if (params.internalFormat === _gl.RGBA16F ) {
				params.format = _gl.RGBA;
				params.type = _gl.HALF_FLOAT;
			} else if (params.internalFormat === _gl.RGBA32F ) {
				params.format = _gl.RGBA;
				params.type = _gl.FLOAT;
			} else if (params.internalFormat === _gl.RGBA ) {
				params.format = _gl.RGBA;
				params.type = _gl.UNSIGNED_BYTE;
			}

			return params;

		}

		function resizeBuffer_ ( params ) {

			if ( _bufferSize.width < 2 || _bufferSize.height < 2 ) {
				console.error('Texture too small');
				return;
			}

			params = populateParams( params );

			_gl.activeTexture( _gl.TEXTURE0 + params.textureUnitId );
			_gl.bindTexture( _gl.TEXTURE_2D, params.texture );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_MAG_FILTER, _gl.NEAREST );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_MIN_FILTER, _gl.NEAREST );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_WRAP_S, _gl.CLAMP_TO_EDGE );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_WRAP_T, _gl.CLAMP_TO_EDGE );

			_gl.texImage2D(
				_gl.TEXTURE_2D,
				0,
				params.internalFormat,
				_bufferSize.width,
				_bufferSize.height,
				0,
				params.format,
				params.type,
				null
			);

			const attachOffset = params.textureUnitId;
			if (params.attachOffset !== undefined )
				attachOffset : params.attachOffset;

			_gl.framebufferTexture2D(
				_gl.FRAMEBUFFER,
				_gl.COLOR_ATTACHMENT0 + attachOffset,
				_gl.TEXTURE_2D,
				params.texture,
				0
			);
		}

		function bindColorBuffers_( pingPongIndex ) {

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _colorBuffers[ pingPongIndex ] );
			_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT0 + 1 ] );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, _frontColorTarget[ pingPongIndex ], 0 );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + 1, _gl.TEXTURE_2D, _backColorTarget [ pingPongIndex ], 0 );

		}

		function checkCurrentFrameBuffer () {

			// Debugging tests for the framebuffer. Disable unless you need it.
			var status = _gl.checkFramebufferStatus( _gl.FRAMEBUFFER );

			if ( status !== _gl.FRAMEBUFFER_COMPLETE ) {
				if ( status === _gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT )
					console.warn( 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT' );
				else if ( status === _gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT )
					console.warn( 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT' );
				else if ( status === _gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS )
					console.warn( 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS' );
				else if ( status === _gl.FRAMEBUFFER_UNSUPPORTED )
					console.warn( 'FRAMEBUFFER_UNSUPPORTED' );
				else if ( status === _gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE )
					console.warn( 'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE' );
			}

		}

		this.checkFrameBuffer = checkCurrentFrameBuffer;
		this.resizeBuffer = resizeBuffer_;

		class WebGLDPBufferSet {
			constructor( gl, id ) {

				this.id = id;
				var
					_gl = gl;

				var
					_tuIdDepth = 0,
					_tuIdFront = 1,
					_tuIdBack = 2,
					_depthBuffer = _gl.createFramebuffer(),
					_colorBuffer = _gl.createFramebuffer(),
					_depthTarget = _gl.createTexture(),
					_frontColorTarget = _gl.createTexture(),
					_backColorTarget = _gl.createTexture(),
					_mode = 'unknown';

				this.depthTarget = _depthTarget;
				this.frontColorTarget = _frontColorTarget;
				this.backColorTarget = _backColorTarget;

				_gl.bindFramebuffer( _gl.FRAMEBUFFER, _depthBuffer );
				_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT1, _gl.COLOR_ATTACHMENT2 ] );
				_gl.bindFramebuffer( _gl.FRAMEBUFFER, _colorBuffer );
				_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT1 ] );

				function bindColorBuffer( ) {

					_gl.activeTexture( _gl.TEXTURE0 );
					_gl.bindTexture( _gl.TEXTURE_2D, _frontColorTarget );
					_gl.activeTexture( _gl.TEXTURE1 );
					_gl.bindTexture( _gl.TEXTURE_2D, _backColorTarget );

					// _gl.drawBuffers makes a permanent state change on the frameBuffer, it only needs to be done once
					_gl.bindFramebuffer( _gl.FRAMEBUFFER, _colorBuffer );

					// This may not be needed
					_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, _frontColorTarget, 0 );
					_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT1, _gl.TEXTURE_2D, _backColorTarget, 0 );

				}

				function bindDepthFrameBuffer( ) {

					_gl.activeTexture( _gl.TEXTURE0 );
					_gl.bindTexture( _gl.TEXTURE_2D, _depthTarget );
					_gl.activeTexture( _gl.TEXTURE1 );
					_gl.bindTexture( _gl.TEXTURE_2D, _frontColorTarget );
					_gl.activeTexture( _gl.TEXTURE2 );
					_gl.bindTexture( _gl.TEXTURE_2D, _backColorTarget );

					// _gl.drawBuffers makes a permanent state change on the frameBuffer, it only needs to be done once
					_gl.bindFramebuffer( _gl.FRAMEBUFFER, _depthBuffer );

					// This may not be needed
					_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, _depthTarget, 0 );
					_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT1, _gl.TEXTURE_2D, _frontColorTarget, 0 );
					_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT2, _gl.TEXTURE_2D, _backColorTarget, 0 );

				}

				this.resize = function( ) {

					bindDepthFrameBuffer();

					resizeBuffer_( {
						textureUnitId: _tuIdDepth,
						texture: _depthTarget,
						internalFormat: _gl.RGBA32F
					} );

					resizeBuffer_( {
						textureUnitId: _tuIdFront,
						texture: _frontColorTarget,
						internalFormat: _gl.RGBA
					} );

					resizeBuffer_( {
						textureUnitId: _tuIdBack,
						texture: _backColorTarget,
						internalFormat: _gl.RGBA
					} );
					checkCurrentFrameBuffer();

					bindColorBuffer();
					checkCurrentFrameBuffer();
				};

				this.bindForWriting = function ( passNum ) {
//					console.warn("\nPass: " + passNum + " setting write textures (0,1,2) for " + this.id + "\n" );
					_mode = 'write';
					_gl.activeTexture(_gl.TEXTURE0 );
					_gl.bindTexture(_gl.TEXTURE_2D, _depthTarget);

					_gl.activeTexture(_gl.TEXTURE1 );
					_gl.bindTexture(_gl.TEXTURE_2D, _frontColorTarget);

					_gl.activeTexture(_gl.TEXTURE2 );
					_gl.bindTexture(_gl.TEXTURE_2D, _backColorTarget);

					bindDepthFrameBuffer();
				};

				this.bindForReading = function ( passNum ) {
					_mode = 'read';
					const program = _state.getCurrentProgram();
					if (program) {
//						console.warn("\nPass: " + passNum + " setting read textures (3,4) for " + this.id + "\n");

						_gl.activeTexture(_gl.TEXTURE3);
						_gl.bindTexture(_gl.TEXTURE_2D, _depthTarget);

						_gl.activeTexture(_gl.TEXTURE4);
						_gl.bindTexture(_gl.TEXTURE_2D, _frontColorTarget);

					}
				};

				this.setReadUniforms = function () {
					const program = _state.getCurrentProgram();
					if ( program ) {

						_gl.activeTexture(_gl.TEXTURE3 );
						_gl.bindTexture(_gl.TEXTURE_2D, _depthTarget);

						_gl.activeTexture(_gl.TEXTURE4 );
						_gl.bindTexture(_gl.TEXTURE_2D, _frontColorTarget);

						const depthBufferInLoc = _gl.getUniformLocation(program, "depthBufferIn");
						const frontColorInLoc = _gl.getUniformLocation(program, "frontColorIn");

						_gl.uniform1i( depthBufferInLoc, 3 );
						_gl.uniform1i( frontColorInLoc, 4 );

					}
				};

				this.clear = function ( nearDepth, farDepth ) {

					// Order is important.
					// TBD Potential optimization

					// This will clear ALL three textures with the depth values
					_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _depthBuffer );
					_gl.clearColor(nearDepth, farDepth, 0, 0);
					_gl.clear(_gl.COLOR_BUFFER_BIT);

					// This will clear just the two color textures
					_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _colorBuffer );
					_gl.clearColor(0, 0, 0, 0);
					_gl.clear(_gl.COLOR_BUFFER_BIT);

					_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, null );

				};

				this.getDumpParams = function (tf, bufferId) {
					var result = {
						mode: _mode,
						bufferId:  bufferId,
					};

					switch (bufferId) {
						case 	tf.drawFrontColor:
							result.testMode = tf.testModeDrawColor;
							result.texture = _frontColorTarget;
							break;
						case 	tf.drawBackColor:
							result.testMode = tf.testModeDrawColor;
							result.texture = _backColorTarget;
							break;

						case 	tf.drawDepthNear:
							result.testMode = tf.testModeDrawDepthNear;
							result.texture = _depthTarget;
							break;
						case 	tf.drawDepthFar:
							result.testMode = tf.testModeDrawDepthFar;
							result.texture = _depthTarget;
							break;
						case 	tf.drawDepthBack:
							result.testMode = tf.testModeDrawDepthBack;
							result.texture = _depthTarget;
							break;
					}
					return result;
				};

				this.dispose = function ( ) {

					console.warn('DPBufferSet.dispose is not tested yet.');

					if (_depthTarget) {
						_gl.deleteTexture(_depthTarget);
						_gl.deleteTexture(_frontColorTarget);
						_gl.deleteTexture(_backColorTarget);
						_gl.deleteFramebuffer(_depthBuffer);
						_gl.deleteFramebuffer(_colorBuffer);
						_depthTarget = null;
						_frontColorTarget = null;
						_backColorTarget = null;
						_depthBuffer = null;
						_colorBuffer = null;
					}

				};
			}

		}

		var
			_readBufs = new WebGLDPBufferSet( _gl, "Set A" ),
			_writeBufs = new WebGLDPBufferSet( _gl, "Set B" ),
			_blendBackBuffer = _gl.createFramebuffer(),
			_blendBackTarget = _gl.createTexture(),
			_tuIdBlendBack = 5; // 0,1,2 for writing 3,4 for reading -> 5 for the blend tic

		this.resize = function ( bufferSize ) {

			_bufferSize = bufferSize;
			_readBufs.resize();
			_writeBufs.resize();

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _blendBackBuffer );
			resizeBuffer_( {
				textureUnitId: _tuIdBlendBack,
				attachOffset: 0,
				texture: _blendBackTarget,
				internalFormat: _gl.RGBA
			} );

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

/*
			bindColorBuffers_  ( 0 );

			bindColorBuffers_  ( 1 );
*/
		};

		function clearWriteBuffers (captureImageForDump) {

			// An arbitrarily large negative number that will be less than all other numbers;
			const DEPTH_CLEAR_VALUE = -99999.0;

			_writeBufs.clear(DEPTH_CLEAR_VALUE, DEPTH_CLEAR_VALUE);

			if ( captureImageForDump ) {

				const tf = new DPTestFlags();
				captureImageForDump({
					bufferId: tf.drawDepthNear,
					testMode: tf.testModeDrawDepthNear,
					mode: 'preWrite',
					texture: _writeBufs.depthTarget
				});

				captureImageForDump({
					bufferId: tf.drawDepthFar,
					testMode: tf.testModeDrawDepthFar,
					mode: 'preWrite',
					texture: _writeBufs.depthTarget
				});
			}

			_gl.activeTexture( _gl.TEXTURE5 );
			_gl.bindTexture( _gl.TEXTURE_2D, _blendBackTarget );

			_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _blendBackBuffer);
			_gl.clearColor(0, 0, 0, 0);
			_gl.clear(_gl.COLOR_BUFFER_BIT);

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		function clearReadBuffers ( isFirstPass ) {

			if ( isFirstPass ) {

				_readBufs.clear(1.0, 1.0);

			}

		}

		function swapBufferSets ( ) {

			const temp = _readBufs;
			_readBufs = _writeBufs;
			_writeBufs = temp;

		}

		this.beginDrawPass = function( passNum, captureImageForDump ) {

			swapBufferSets();
//			console.warn("\n_readBufs: " + _readBufs.id + "\n_writeBufs: " + _writeBufs.id );
			clearWriteBuffers(captureImageForDump);
			clearReadBuffers( passNum === 0 );
			_readBufs.bindForReading( passNum ); // Probably redundant, but leaving it for now.
			_writeBufs.bindForWriting( passNum );
			_gl.blendEquation( _gl.MAX );
			_state.enable( _gl.BLEND );
			_state.disable( _gl.DEPTH_TEST );

		};

		this.bindBuffersForDraw = function () {
			_readBufs.setReadUniforms();
		}

		this.getBlendBackBuffer = function () {
			return _blendBackBuffer;
		};

		// This returns the texture unit id of the back color texture that was just written to
		this.getBackColorTextureUnitID = function ( ) {
			return 2;
		};

		// This returns the texture unit id of the front color texture that was just written to
		this.getFrontColorTextureUnitID = function ( ) {
			return 1;
		};

		// This returns the texture unit id of the front color texture that was just written to
		this.getBlendTextureUnitID = function ( ) {
			return 5;
		};

		this.getAllFrames = function ( captureImageForDump ) {

			const tf = new DPTestFlags();

			for (var i = tf.drawFrontColor; i <= tf.drawDepthFar; i++ ) {

				captureImageForDump( _readBufs.getDumpParams( tf, i ) );
				captureImageForDump( _writeBufs.getDumpParams( tf, i ) );

			}

			captureImageForDump({
				bufferId:  tf.drawBlendBack,
				mode: 'blend',
				texture:  _blendBackTarget
			} );

		}

		this.dispose = function ( ) {
			if (_blendBackBuffer) {
				_readBufs.dispose();
				_writeBufs.dispose();
				_gl.deleteTexture(_blendBackTarget);
				_gl.deleteFramebuffer(_blendBackBuffer);

				_readBufs = null;
				_writeBufs = null;
				_blendBackTarget = null;
				_blendBackBuffer = null;
			}

		};

	}

}

export {
	DPTestFlags,
	WebGLDPBuffers
};
