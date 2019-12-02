import depthPeelingPrefixChunk from './shaders/ShaderChunk/depth_peeling_prefix.glsl.js';
import gammaFuncs from './shaders/ShaderChunk/depth_peeling_gamma_functions.glsl.js';
import depthPeelingMainPrefixChunk from './shaders/ShaderChunk/depth_peeling_main_prefix.glsl.js';
import depthPeelingMainSuffixChunk from './shaders/ShaderChunk/depth_peeling_main_suffix.glsl.js';

class WebGLDepthPeeling {

	constructor(renderer, numDepthPeelingPasses) {
		// Debugging options. See implementation for details.

		// The following controls with buffers to render to the screen if _debugDrawBuffersDelay > 0
		const _debugDrawBuffersDelay = 10;

		// Sets an override maximum on the number of depth peeling passes in the loop
		const _debugMaxDepthPeelingPasses = 2;

		class ProgramData {

			constructor() {

				this.program = null;
				this.frontColorInLoc = null;
				this.uBackColorBuffer = null;
				this.testModeLoc = null;

			}

		}

		this.initialized = false;
		this.depthPeelingRender = true; // internal flag used to control type of render
		this.numDepthPeelingPasses = numDepthPeelingPasses;

		const _depthTexUnitOffset = 0,
					_frontColorTexUnitOffset = 1,
					_backColorTexUnitOffset = 2,
					_blendBackTexUnit = 6;

		var _this = this,
				_renderer = renderer,
		 		_gl, // Can't initialize this until later in the process, but need to declare it here.
				_quadBuffer,
				_numQuadVertices,
				_readId = 0,
				_writeId = 1,
				_dpPass = -1;

		var _depthBuffers,
				_colorBuffers,
				_blendBackBuffer,
				_depthTarget,
				_frontColorTarget,
				_backColorTarget,
				_blendBackTarget;

		this.getNumDepthPeelingPasses = function () {
			if (_debugMaxDepthPeelingPasses > 1)
				return _debugMaxDepthPeelingPasses;
			return this.numDepthPeelingPasses;
		};

		this.isDepthPeelingOn = function () {
			return this.depthPeelingRender && this.numDepthPeelingPasses > 0;
		};

		this.getPrefixFragment = function () {
			var result = this.isDepthPeelingOn() ? [
				'#define DEPTH_PEELING 1',
				depthPeelingPrefixChunk,
				gammaFuncs
			].join('\n') : '';

			return result;
		};

		this.modifyFragmentShader = function ( fragmentGlsl ) {

			var depthPeelingEnabled = this.isDepthPeelingOn();

			var fragmentGlslPrefix = depthPeelingEnabled ?
			'\n' + depthPeelingMainPrefixChunk :
				'';

			var testStr;
			var tfcString = ' vec4 three_FragColor;';

			testStr = 'void main() {';
			if (fragmentGlsl.indexOf(testStr) !== -1) {
				if (fragmentGlsl.indexOf(testStr + tfcString) === -1) {
					fragmentGlsl = fragmentGlsl.replace(testStr, testStr + tfcString + fragmentGlslPrefix);
				}
			} else {
				testStr = 'void main(){';
				if (fragmentGlsl.indexOf(testStr) !== -1) {
					if (fragmentGlsl.indexOf(testStr + tfcString) === -1) {
						fragmentGlsl = fragmentGlsl.replace(testStr, testStr + tfcString + fragmentGlslPrefix);
					}
				}
			}
			if (fragmentGlsl.indexOf('vec4 three_FragColor') === -1) {
				console.error('three_FragColor not declared in fragment shader');
			}

			var fragmentGlslSuffix = depthPeelingEnabled ?
				depthPeelingMainSuffixChunk :
				'gl_FragColor = three_FragColor;';
			fragmentGlsl = fragmentGlsl.substring(0 , fragmentGlsl.length - 1);
			fragmentGlsl = fragmentGlsl + '\n' + fragmentGlslSuffix + '\n}';

/*
			 if ( depthPeelingEnabled ) {
			 console.warn("***************************fragmentGlsl:\n" + fragmentGlsl + '\n***************************\n')
			 }
*/

			return fragmentGlsl;
		};

		function _setupQuads() {

			// Quad for draw pass
			var quadVertices = new Float32Array( [
				- 1,   1, - 1, - 1, 1, - 1,
				- 1,   1,   1, - 1, 1,   1
			] );

			_numQuadVertices = quadVertices.length / 2;
			_quadBuffer = _gl.createBuffer();
			_gl.bindBuffer( _gl.ARRAY_BUFFER, _quadBuffer );
			_gl.bufferData( _gl.ARRAY_BUFFER, quadVertices, _gl.STATIC_DRAW );

		};

		function _drawInBufferToOutBuffer() {

			// Draws the shader input(s) to the output buffer by rendering a full screen
			// quad (2 triangles)
			_gl.bindBuffer( _gl.ARRAY_BUFFER, _quadBuffer );
			_gl.vertexAttribPointer( 0, 2, _gl.FLOAT, false, 0, 0 );

			_gl.drawArrays( _gl.TRIANGLES, 0, _numQuadVertices );

		};

		function _createBuffers () {

			// 2 for ping-pong
			// COLOR_ATTACHMENT0 - front color
			// COLOR_ATTACHMENT1 - back color
			_depthBuffers = [_gl.createFramebuffer(), _gl.createFramebuffer()];
			_colorBuffers = [_gl.createFramebuffer(), _gl.createFramebuffer()];
			_blendBackBuffer = _gl.createFramebuffer();
			_depthTarget = [_gl.createTexture(), _gl.createTexture()];
			_frontColorTarget = [_gl.createTexture(), _gl.createTexture()];
			_backColorTarget = [_gl.createTexture(), _gl.createTexture()];
			_blendBackTarget = _gl.createTexture();
			_setupQuads();

		};

		function _initBuffers() {

			if ( _this.initialized )
				return;

			if ( _gl === undefined )
				_gl = _renderer.context;

			_gl.getExtension( "EXT_color_buffer_float" );

			_createBuffers();
			_this.setupShaders_();
			_this.initialized = true;

		};

		this.beginDrawLoop = function ( camera ) {

			_initBuffers();
			this.resizeBuffers( _gl.drawingBufferWidth, _gl.drawingBufferHeight );
		};

		this.setupShaders_ = function () {

			var srcVertexShaderQuad = `#version 300 es
			in vec4 inPosition;
			void main() {
				gl_Position = inPosition;
			}
		`;

			var srcFragmentShaderBlendBack = `#version 300 es
			precision highp float;
			uniform sampler2D uBackColorBuffer;
			
			out vec4 fragColor;
			void main() {
			
				// Blend back is using onboard blending, it has gamma correction
				fragColor = texelFetch(uBackColorBuffer, ivec2(gl_FragCoord.xy), 0);

				if (fragColor.a == 0.0) {
					discard;
				}
			}
		`;

			var srcFragmentShaderFinal =
`#version 300 es
precision highp float;
uniform sampler2D frontColorIn;
uniform sampler2D uBackColorBuffer;
uniform int testMode;

#define DEPTH_PEELING 1
` + gammaFuncs + `\n			
out vec4 fragColor;
void main() {
	// Blend final, needs gamma correction
	// See more complete description in peeling fragment shader

	ivec2 fragCoord = ivec2(gl_FragCoord.xy);
	if (testMode == 0) {
		vec4 frontColor = texelFetch(frontColorIn, fragCoord, 0);
		vec4 backColor = texelFetch(uBackColorBuffer, fragCoord, 0);
	
		float alphaMultiplier = 1.0 - lin(frontColor.a);
	
		vec3 color = nonLin(lin(frontColor.rgb) + alphaMultiplier * lin(backColor.rgb));
	
	
		fragColor = vec4(
			color,
			nonLin(lin(frontColor.a) + lin(backColor.a))
		);
	} else if (testMode == 1) {
		vec2 depth = texelFetch(frontColorIn, fragCoord.xy, 0).rg;
		float farDepth = -depth.x;
		float nearDepth = depth.y;

		float thresh = 0.5;
		float step = 0.25;
		thresh += step; step *= 0.5;
		thresh -= step; step *= 0.5;
		thresh += step; step *= 0.5;
		thresh -= step; step *= 0.5;
		thresh += step; step *= 0.5;
		thresh += step; step *= 0.5;
		thresh += step; step *= 0.5;
		thresh -= step; step *= 0.5;
		
		float r = (farDepth - thresh) * 1.0 + 0.5;
		float g = (nearDepth - thresh) * 1.0 + 0.5;

		fragColor = vec4(farDepth, nearDepth, 0, 1);

	} else {

		fragColor = texelFetch(frontColorIn, fragCoord, 0);

	}
}
`;

			function createShader( type, source, name ) {

				var shader = _gl.createShader( type );
				_gl.shaderSource( shader, source );
				_gl.compileShader( shader );
				if ( ! _gl.getShaderParameter( shader, _gl.COMPILE_STATUS ) ) {

					console.error( "Shader compile error in " + name );
					console.error( _gl.getShaderInfoLog( shader ) );
					console.log( source );

				}
				return shader;

			}

			function createProgram(
				vertShader,
				fragShader,
				name
			) {

				var program = _gl.createProgram();
				_gl.attachShader( program, vertShader );
				_gl.attachShader( program, fragShader );
				_gl.linkProgram( program );
				if ( ! _gl.getProgramParameter( program, _gl.LINK_STATUS ) ) {

					console.error( "Shader compile error in " + name );
					console.error( _gl.getProgramInfoLog( program ) );

				}
				return program;

			}

			var fullScreenQuadVertexShader = createShader(
				_gl.VERTEX_SHADER,
				srcVertexShaderQuad,
				"vertexShaderQuad"
			);
			var finalFragmentShader = createShader(
				_gl.FRAGMENT_SHADER,
				srcFragmentShaderFinal,
				"fragmentShaderFinal"
			);
			var blendBackFragmentShader = createShader(
				_gl.FRAGMENT_SHADER,
				srcFragmentShaderBlendBack,
				"fragmentShaderBlendBack"
			);

			this.blBackPrgData = new ProgramData();
			this.finPrgData = new ProgramData();

			this.blBackPrgData.program = createProgram( fullScreenQuadVertexShader, blendBackFragmentShader, "blBackPrgData" );
			this.blBackPrgData.uBackColorBuffer = _gl.getUniformLocation( this.blBackPrgData.program, "uBackColorBuffer" );

			this.finPrgData.program = createProgram( fullScreenQuadVertexShader, finalFragmentShader, "finPrgData" );
			this.finPrgData.frontColorInLoc  = _gl.getUniformLocation( this.finPrgData.program, "frontColorIn" );
			this.finPrgData.uBackColorBuffer = _gl.getUniformLocation( this.finPrgData.program, "uBackColorBuffer" );
			this.finPrgData.testModeLoc      = _gl.getUniformLocation( this.finPrgData.program, "testMode" );

		};

		function checkBufferSize_ ( width, height ) {
			if ( !_this.initialized ) return false;

			if (_this.bufferSize &&
				_this.bufferSize.width === width &&
				_this.bufferSize.height === height ) {
				// already resized
				return true;
			}

			if (width === -1 && height === -1) {
				if (_this.bufferSize) {
					width = _this.bufferSize.width;
					height = _this.bufferSize.height;
				} else {
					console.error('Width and height not set');
					return false;
				}
			}

			var arbitraryMinBufferSize = 4;
			if (!width || !height ||
				(width < arbitraryMinBufferSize && height < arbitraryMinBufferSize)) {
				// Test for an arbitrarily small buffer
				console.warn('WebGLDepthPeeling.resizeBuffers_ called with bad sizes');
				return false;
			}

			_this.bufferSize = {
				width: width,
				height: height
			};

			return true;

		}

		function resizeBuffer_ ( params ) {

			console.log(`binding and sizing buffers.
			texUnit     :` + params.texUnit +`
			attachOffset:` + params.attachOffset +`
			`);

			_gl.activeTexture( _gl.TEXTURE0 + params.texUnit );
			_gl.bindTexture( _gl.TEXTURE_2D, params.texture );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_MAG_FILTER, _gl.NEAREST );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_MIN_FILTER, _gl.NEAREST );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_WRAP_S, _gl.CLAMP_TO_EDGE );
			_gl.texParameteri( _gl.TEXTURE_2D, _gl.TEXTURE_WRAP_T, _gl.CLAMP_TO_EDGE );
			_gl.texImage2D(
				_gl.TEXTURE_2D,
				0,
				params.internalFormat,
				_this.bufferSize.width,
				_this.bufferSize.height,
				0,
				params.format,
				params.type,
				null
			);
			_gl.framebufferTexture2D(
				_gl.FRAMEBUFFER,
				_gl.COLOR_ATTACHMENT0 + params.attachOffset,
				_gl.TEXTURE_2D,
				params.texture,
				0
			);

		}

		function resizeDepthBuffer_ ( texOffset, attachOffset, texture ) {
			// The _gl version of these constants cause warnings in npm run build.
			// Define our own locally to avoid this.

			var RG32F = 0x8230;
			var RG = 0x8227;

			resizeBuffer_( {
				texUnit: texOffset + attachOffset,
				attachOffset: attachOffset,
				texture: texture,
				internalFormat: RG32F,
				format: RG,
				type: _gl.FLOAT
			} );

		}

		function resizeColorBuffer_ ( texOffset, attachOffset, texture) {
			resizeBuffer_( {
				texUnit: texOffset + attachOffset,
				texture: texture,
				attachOffset: attachOffset,
				internalFormat: _gl.RGBA16F,
				format: _gl.RGBA,
				type: _gl.HALF_FLOAT
			} );

		}

		function bindColorBuffers_( pingPongIndex ) {

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _colorBuffers[ pingPongIndex ] );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, _frontColorTarget[ pingPongIndex ], 0 );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + 1, _gl.TEXTURE_2D, _backColorTarget [ pingPongIndex ], 0 );
			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		function resizeDepthBuffers_ ( pingPongIndex ) {

			var texOffset = pingPongIndex * 3;

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _depthBuffers[ pingPongIndex ] );
			resizeDepthBuffer_( texOffset, _depthTexUnitOffset, _depthTarget[ pingPongIndex ] );
			resizeColorBuffer_( texOffset, 1, _frontColorTarget[ pingPongIndex ] );
			resizeColorBuffer_( texOffset, 2, _backColorTarget[ pingPongIndex ] );

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		function resizeBackBuffer_ () {

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _blendBackBuffer );
			resizeBuffer_( {
				texUnit: 6,
				texture: _blendBackTarget,
				attachOffset: 0,
				internalFormat: _gl.RGBA16F,
				format: _gl.RGBA,
				type: _gl.HALF_FLOAT
			} );

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		this.resizeBuffers = function ( width, height ) {

			if ( checkBufferSize_(width, height) ) {

				resizeDepthBuffers_( 0 );
				bindColorBuffers_  ( 0 );

				resizeDepthBuffers_( 1 );
				bindColorBuffers_  ( 1 );

				resizeBackBuffer_();

				_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

			}

		};

		function initializeBuffersForPass_() {

			_gl.activeTexture(_gl.TEXTURE0 + 0 + _depthTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, _depthTarget[0]);

			_gl.activeTexture(_gl.TEXTURE0 + 0 + _frontColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, _frontColorTarget[0]);

			_gl.activeTexture(_gl.TEXTURE0 + 0 + _backColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, _backColorTarget[0]);

			_gl.activeTexture(_gl.TEXTURE0 + 3 + _depthTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, _depthTarget[1]);

			_gl.activeTexture(_gl.TEXTURE0 + 3 + _frontColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, _frontColorTarget[1]);

			_gl.activeTexture(_gl.TEXTURE0 + 3 + _backColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, _backColorTarget[1]);

			_gl.activeTexture( _gl.TEXTURE0 + _blendBackTexUnit );
			_gl.bindTexture( _gl.TEXTURE_2D, _blendBackTarget );

		};

		function clearBuffersForDraw_ ( init ) {

			const DEPTH_CLEAR_VALUE = -99999.0;
			const MAX_DEPTH_ = 1.0; // furthest
			const MIN_DEPTH_ = 0.0; // nearest

			_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _depthBuffers[_writeId]);
			_gl.clearColor(DEPTH_CLEAR_VALUE, DEPTH_CLEAR_VALUE, 0, 0);
			_gl.clear(_gl.COLOR_BUFFER_BIT);

			_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _colorBuffers[_writeId]);
			_gl.clearColor(0, 0, 0, 0);
			_gl.clear(_gl.COLOR_BUFFER_BIT);

			if (init) {
				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _depthBuffers[_readId]);
				_gl.clearColor(-MIN_DEPTH_, MAX_DEPTH_, 0, 0);
				_gl.clear(_gl.COLOR_BUFFER_BIT);

				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _colorBuffers[_readId]);
				_gl.clearColor(0, 0, 0, 0);
				_gl.clear(_gl.COLOR_BUFFER_BIT);
			}

			_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _blendBackBuffer);
			_gl.clearColor(0, 0, 0, 0);
			_gl.clear(_gl.COLOR_BUFFER_BIT);

		};

		this.beginPass = function( passNum ) {
			this.passNum = passNum;
			_readId = passNum % 2;
			_writeId = 1 - _readId;
			initializeBuffersForPass_();
			clearBuffersForDraw_(passNum === 0);
		};

		this.bindBuffersForDraw = function ( tjsProgram ) {

			if (tjsProgram && tjsProgram.program && this.isDepthPeelingOn()) {
				var program = tjsProgram.program;

/*
				// Clear input color buffer test - passes. This test changes the color of the next pass
				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _colorBuffers[_readId]);
				_gl.drawBuffers([_gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT0 + 1]);
				_gl.clearColor(0, 1, 0, 0.5);
				_gl.clear(_gl.COLOR_BUFFER_BIT);
*/

				var offsetRead = 3 * _readId;

				_gl.bindFramebuffer( _gl.DRAW_FRAMEBUFFER, _depthBuffers[ _writeId ] );
				_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT0 + 1, _gl.COLOR_ATTACHMENT0 + 2 ] );
				_gl.blendEquation( _gl.MAX );
				_gl.enable( _gl.BLEND );
				_gl.disable( _gl.DEPTH_TEST );
				_gl.enable( _gl.CULL_FACE );

				var depthBufferInLoc = _gl.getUniformLocation(program, "depthBufferIn");
				var frontColorInLoc = _gl.getUniformLocation(program, "frontColorIn");

				_gl.uniform1i( depthBufferInLoc, offsetRead );
				_gl.uniform1i( frontColorInLoc, offsetRead + _frontColorTexUnitOffset ); // Read from front color
			}

		};

		this.endPass = function () {

			var offsetBack = _writeId * 3;
			_gl.bindFramebuffer( _gl.DRAW_FRAMEBUFFER, _blendBackBuffer );
			_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0 ] );
			_gl.blendEquation( _gl.FUNC_ADD );
			_gl.blendFuncSeparate( _gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA, _gl.ONE, _gl.ONE_MINUS_SRC_ALPHA );
/*
			// buffer testing. This test passes also, the screen background turns blue
			_gl.clearColor(0, 0, 1, 0.5);
			_gl.clear(_gl.COLOR_BUFFER_BIT);
*/

			_gl.useProgram( this.blBackPrgData.program );
			_gl.uniform1i( this.blBackPrgData.uBackColorBuffer, offsetBack + _backColorTexUnitOffset );

			_drawInBufferToOutBuffer();

		};

		function _blendFinal() {
/*
			 // buffer testing
			 _gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _colorBuffers[_writeId]);
			 _gl.clearColor(1, 0, 0, 0.5);
			 _gl.clear(_gl.COLOR_BUFFER_BIT);

			 _gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _blendBackBuffer);
			 _gl.clearColor(0, 1, 0, 0.5);
			 _gl.clear(_gl.COLOR_BUFFER_BIT);
*/
			var pingPongOffset = _writeId * 3;
			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(_this.finPrgData.program);
			_gl.uniform1i(_this.finPrgData.frontColorInLoc, pingPongOffset + _frontColorTexUnitOffset); // Read from front color buffer
			_gl.uniform1i(_this.finPrgData.uBackColorBuffer, _blendBackTexUnit); // Read from blend back buffer
			_gl.uniform1i(_this.finPrgData.testModeLoc, 0); // set shader to normal mode

			_drawInBufferToOutBuffer();

		}

		function _drawDebugBufferToScreen( params) {
			if (params.flagChanged)
				console.warn(params.label);

			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(_this.finPrgData.program);
			_gl.uniform1i(_this.finPrgData.testModeLoc, params.testMode );
			_gl.uniform1i(_this.finPrgData.frontColorInLoc, params.texUnit);

			_drawInBufferToOutBuffer();
		}

		function _drawDepthBufferToScreen ( id, flagChanged ) {

			var pingPongOffset = id * 3;
			_drawDebugBufferToScreen({
				flagChanged: flagChanged,
				testMode: 1,
				texUnit: pingPongOffset + _depthTexUnitOffset,
				label:'testFlag: depth ' + (id == _readId ? 'read' : 'write')
			} );

		}

		function drawFrontColorBufferToScreen ( id, flagChanged ) {

			var pingPongOffset = id * 3;
			_drawDebugBufferToScreen({
				flagChanged: flagChanged,
				testMode: 2,
				texUnit: pingPongOffset + _frontColorTexUnitOffset,
				label:'testFlag: front ' + (id == _readId ? 'read' : 'write')
			} );

		}

		function _drawBackColorBufferToScreen(id, flagChanged ) {

			var pingPongOffset = id * 3;
			_drawDebugBufferToScreen({
				flagChanged: flagChanged,
				testMode: 2,
				texUnit: pingPongOffset + _backColorTexUnitOffset,
				label:'testFlag: back ' + (id == _readId ? 'read' : 'write')
			} );

		};

		function _drawBlendBackBufferToScreen( flagChanged ) {

			_drawDebugBufferToScreen( {
				flagChanged: flagChanged,
				testMode: 2,
				texUnit: _blendBackTexUnit,
				label:'testFlag: blendBack'
			} );

		};

		this.endDrawLoop = function () {

			/*
			IT IS STRONGLY RECOMMENDED that you leave the debugging code in place. It took many days of trial and error to find
			this method and getting it working. Without it you are programming in the dark.

			This allows you to view each buffer during the render. It's about the only way to view and
			debug the depth peeling process.

			If a future node.js/Electron/chromium update allows reading gl.FLOAT using readPixels, it should be replaced with a
			real frame dump to disk image.

		 */

			const testFlagNormal = 0;
			const testFlagDrawFrontColor = 1;
			const testFlagDrawBackColor = 2;
			const testFlagDrawDepthBufferRead = 3;
			const testFlagDrawDepthBufferWrite = 4;
			const testFlagDrawBlendBackBuffer = 5;

			const buffsToDraw = [
				testFlagNormal,
				testFlagDrawFrontColor,
				testFlagDrawBackColor,
				testFlagDrawDepthBufferRead,
				testFlagDrawDepthBufferWrite,
				testFlagDrawBlendBackBuffer
			];

			if (_debugDrawBuffersDelay < 0) {

				_blendFinal();

			} else {

				var flagChanged = false;
				if (this.testIndex === undefined) {

					this.tick = 0;
					this.testIndex = 0;
					flagChanged = true;

				} else {

					this.tick++;
					if (this.tick > _debugDrawBuffersDelay) {

						this.tick = 0;
						this.testIndex++;
						if (this.testIndex >= buffsToDraw.length) {

							this.testIndex = 0;

						}
						flagChanged = true;

					}

				}

				var testFlag = buffsToDraw[this.testIndex];
				if (testFlag === testFlagNormal)
					_blendFinal();
				else if (testFlag === testFlagDrawFrontColor)
					_drawDepthBufferToScreen( _writeId, flagChanged);
				else if (testFlag === testFlagDrawBackColor)
					_drawBackColorBufferToScreen(_writeId, flagChanged);
				else if (testFlag === testFlagDrawDepthBufferRead)
					_drawDepthBufferToScreen(_readId, flagChanged);
				else if (testFlag === testFlagDrawDepthBufferWrite)
					_drawDepthBufferToScreen(_writeId, flagChanged);
				else if (testFlag === testFlagDrawBlendBackBuffer)
					_drawBlendBackBufferToScreen(flagChanged);

			}

		};

		this.dispose = function ( ) {

			console.warn('WebGLDepthPeeling.dispose is not tested yet.');

			if (_blendBackBuffer) {
				_gl.deleteFramebuffer(_blendBackBuffer);
				_blendBackBuffer = null;
			}

			if (_depthTarget) {
				_gl.deleteTexture(_depthTarget[0]);
				_gl.deleteTexture(_depthTarget[1]);
				_depthTarget = null;
			}

			if (_frontColorTarget) {
				_gl.deleteTexture(_frontColorTarget[0]);
				_gl.deleteTexture(_frontColorTarget[1]);
				_frontColorTarget = null;
			}

			if (_backColorTarget) {
				_gl.deleteTexture(_backColorTarget[0]);
				_gl.deleteTexture(_backColorTarget[1]);
				_backColorTarget = null;
			}

			if (_blendBackTarget) {
				_gl.deleteTexture(_blendBackTarget);
				_blendBackTarget = null;
			}
		};

	};

}

export { WebGLDepthPeeling };
