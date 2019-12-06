import { CullFaceNone } from '../constants';
import { WebGLErrorReporter } from './webgl/WebGLErrorReporter';
import depthPeelingPrefixChunk from './shaders/ShaderChunk/depth_peeling_prefix.glsl';
import gammaFuncs from './shaders/ShaderChunk/depth_peeling_gamma_functions.glsl';
import depthPeelingMainPrefixChunk from './shaders/ShaderChunk/depth_peeling_main_prefix.glsl';
import depthPeelingMainSuffixChunk from './shaders/ShaderChunk/depth_peeling_main_suffix.glsl';
import srcVertexShaderQuad from './shaders/ShaderChunk/depth_peeling_quad_vertex_shader.glsl';
import srcFragmentShaderBlendBack from './shaders/ShaderChunk/depth_peeling_fragment_blend_back.glsl';
import srcFragmentShaderFinal0 from './shaders/ShaderChunk/depth_peeling_fragment_final_0.glsl';
import srcFragmentShaderFinal1 from './shaders/ShaderChunk/depth_peeling_fragment_final_1.glsl';

import Preprocessor from '@andrewray/glsl-preprocessor';

class WebGLDepthPeeling {

	constructor(renderer, numDepthPeelingPasses) {
		// Debugging options. See implementation for details.

		// The following controls with buffers to render to the screen if _debugDrawBuffersDelay > 0
		const _debugDrawBuffersDelay = -1;

		// Sets an override maximum on the number of depth peeling passes in the loop
		var _debugNumDepthPeelingPasses = 1;

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

		const
			_depthTexUnitOffset = 0,
			_frontColorTexUnitOffset = 1,
			_backColorTexUnitOffset = 2,
			_blendBackTexUnit = 6;

		var
			_this = this,
			_renderer = renderer,
			_gl = renderer.context,
			_state = renderer.state,
			_quadBuffer,
			_numQuadVertices,
			_readId = 0,
			_writeId = 1,
			_dpPass = -1,
			_testTick = 0,
			_testIndex = 0;

		var _depthBuffers,
				_colorBuffers,
				_blendBackBuffer,
				_depthTarget,
				_frontColorTarget,
				_backColorTarget,
				_blendBackTarget;

		this.getNumDepthPeelingPasses = function () {
			if ( _debugDrawBuffersDelay > 0 ) {
				if (_debugNumDepthPeelingPasses < 1 || _debugNumDepthPeelingPasses > this.numDepthPeelingPasses )
					_debugNumDepthPeelingPasses = 1;
				return _debugNumDepthPeelingPasses;
			}
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

		var _preProc;
		function dumpShaderSource( prefix, source ) {

			const dumpSource = false;
			if ( dumpSource && _this.isDepthPeelingOn() ) {

				if (!_preProc)
					_preProc = new Preprocessor();

				var simplifedSource = _preProc.preprocess(  source );
				console.warn(
					`\n` + prefix + `
raw
*****************
*****************

` + source + `

simplified
*****************
*****************
` + simplifedSource + `
`);

			}

		}

		this.modifyVertexShader = function ( vertexGlsl ) {

			// Empty stub.
			// It had something in it but it was removed. Leaving it for future use.
			return vertexGlsl;

		};

		this.modifyFragmentShader = function ( fragmentGlsl ) {

			var depthPeelingEnabled = this.isDepthPeelingOn();

			dumpShaderSource('pre fragmentGlsl', fragmentGlsl );

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
			fragmentGlsl = fragmentGlsl.substring(0, fragmentGlsl.length - 1);
			fragmentGlsl = fragmentGlsl + '\n' + fragmentGlslSuffix + '\n}';

			dumpShaderSource('post fragmentGlsl', fragmentGlsl );

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

		function loadRequiredExtensions () {

			// BUG, workaround.
			// Shouldn't need this, but the version of WebGL2 being used by electron doesn't have built in float textures
			// as per the spec. Three.js reports that it does.
			var ext1 = _gl.getExtension( "EXT_color_buffer_float" );
			if (!ext1)
				console.warn('EXT_color_buffer_float: not available');

		}

		function initBuffers() {

			if ( _this.initialized )
				return;

			loadRequiredExtensions();

			_createBuffers();
			_this.setupShaders_();
			_this.initialized = true;

		}

		this.beginDrawLoop = function ( ) {

			initBuffers();

			// Special handling of the error wrapper
			var rawGl = ( _gl instanceof WebGLErrorReporter ) ? _gl.gl : _gl;
			this.resizeBuffers( rawGl.drawingBufferWidth, rawGl.drawingBufferHeight );
		};

		this.setupShaders_ = function () {

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

			var srcFragmentShaderFinal = srcFragmentShaderFinal0 + gammaFuncs + srcFragmentShaderFinal1;
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

		function needToResizeBuffers ( width, height ) {
			if ( !_this.initialized )
				return false; // Can't resize

			if (_this.bufferSize &&
				_this.bufferSize.width === width &&
				_this.bufferSize.height === height ) {
				// already resized
				return false;
			}

			if (width === -1 && height === -1) {
				if (_this.bufferSize) {
					width = _this.bufferSize.width;
					height = _this.bufferSize.height;
				} else {
					console.error('Width and height not set');
					return false; // Can't resize
				}
			}

			var arbitraryMinBufferSize = 4;
			if (!width || !height ||
				(width < arbitraryMinBufferSize && height < arbitraryMinBufferSize)) {
				// Test for an arbitrarily small buffer
				console.warn('WebGLDepthPeeling.resizeBuffers_ called with bad sizes');
				return false; // Can't resize
			}

			_this.bufferSize = {
				width: width,
				height: height
			};

			return true; // Must resize

		}

		function populateParams ( params ) {

			// Once an internal format is chosen, there is a table that determines the choice(es) for
			// the format and type. The table is located at
			// https://www.khronos.org/registry/webgl/specs/latest/2.0/#TEXTURE_TYPES_FORMATS_FROM_DOM_ELEMENTS_TABLE
			// This code assures that types are in agreement.

			if (params.internalFormat === _gl.RG32F ) {
				params.format = _gl.RG;
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

			if ( _this.bufferSize.width < 2 || _this.bufferSize.height < 2 ) {
				console.error('Texture too small');
				return;
			}

			params = populateParams( params );

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

			resizeBuffer_( {
				texUnit: texOffset + attachOffset,
				attachOffset: attachOffset,
				texture: texture,
				internalFormat: _gl.RG32F
			} );
		}

		function resizeColorBuffer_ ( texOffset, attachOffset, texture) {
			resizeBuffer_( {
				texUnit: texOffset + attachOffset,
				texture: texture,
				attachOffset: attachOffset,
				internalFormat: _gl.RGBA
			} );

		}

		function bindColorBuffers_( pingPongIndex ) {

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _colorBuffers[ pingPongIndex ] );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, _frontColorTarget[ pingPongIndex ], 0 );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + 1, _gl.TEXTURE_2D, _backColorTarget [ pingPongIndex ], 0 );
			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		function checkFrameBuffer () {
/*
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
*/
		}

		function resizeDepthBuffers_ ( pingPongIndex ) {

			var texOffset = pingPongIndex * 3;

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _depthBuffers[ pingPongIndex ] );
			resizeDepthBuffer_( texOffset, _depthTexUnitOffset, _depthTarget[ pingPongIndex ] );
			resizeColorBuffer_( texOffset, _frontColorTexUnitOffset, _frontColorTarget[ pingPongIndex ] );
			resizeColorBuffer_( texOffset, _backColorTexUnitOffset, _backColorTarget[ pingPongIndex ] );

			checkFrameBuffer();

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		function resizeBackBuffer_ () {

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _blendBackBuffer );
			resizeBuffer_( {
				texUnit: 6,
				texture: _blendBackTarget,
				attachOffset: 0,
				internalFormat: _gl.RGBA16F
			} );

			checkFrameBuffer();

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		this.resizeBuffers = function ( width, height ) {

			if ( needToResizeBuffers(width, height) ) {

				resizeDepthBuffers_( 0 );
				bindColorBuffers_  ( 0 );

				resizeDepthBuffers_( 1 );
				bindColorBuffers_  ( 1 );

				resizeBackBuffer_();

				_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

			}

		};

		function bindDepthBufferTextures() {

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
			bindDepthBufferTextures();
			clearBuffersForDraw_(passNum === 0);
		};

		this.bindBuffersForDraw = function ( ) {

			if (this.isDepthPeelingOn()) {

				/*
				 // Clear input color buffer test - passes. This test changes the color of the next pass
				 _gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _colorBuffers[_readId]);
				 _gl.drawBuffers([_gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT0 + 1]);
				 _gl.clearColor(0, 1, 0, 0.5);
				 _gl.clear(_gl.COLOR_BUFFER_BIT);
				 */

				_gl.bindFramebuffer( _gl.DRAW_FRAMEBUFFER, _depthBuffers[ _writeId ] );
				_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT0 + 1, _gl.COLOR_ATTACHMENT0 + 2 ] );
				_gl.blendEquation( _gl.MAX );
				_state.enable( _gl.BLEND );
				_state.disable( _gl.DEPTH_TEST );
				_state.setCullFace( CullFaceNone );
				checkFrameBuffer();

				var program = _state.getCurrentProgram();
				var depthBufferInLoc = _gl.getUniformLocation(program, "depthBufferIn");
				var frontColorInLoc = _gl.getUniformLocation(program, "frontColorIn");

				var offsetRead = 3 * _readId;
				_gl.uniform1i( depthBufferInLoc, offsetRead );
				_gl.uniform1i( frontColorInLoc, offsetRead + _frontColorTexUnitOffset ); // Read from front color

			}

		};

		// gross overkill, as we should never have more than one
		var _currentProgramStack = [];

		function pushCurrentProgram () {

			_currentProgramStack.push( _renderer.state.getCurrentProgram() );

		}

		function popCurrentProgram () {

			if ( _currentProgramStack.length > 0) {
				_gl.useProgram( _currentProgramStack[_currentProgramStack.length - 1 ] );
				_currentProgramStack.pop();

			}

		}

		this.endPass = function () {

			pushCurrentProgram();

			try {

				var offsetBack = _writeId * 3;
				_gl.bindFramebuffer( _gl.DRAW_FRAMEBUFFER, _blendBackBuffer );
				_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0 ] );
				_gl.blendEquation( _gl.FUNC_ADD );
				_gl.blendFuncSeparate( _gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA, _gl.ONE, _gl.ONE_MINUS_SRC_ALPHA );/*

	/*
				// buffer testing. This test passes also, the screen background turns blue
				_gl.clearColor(0, 0, 1, 0.5);
				_gl.clear(_gl.COLOR_BUFFER_BIT);
	*/

				_gl.useProgram( this.blBackPrgData.program );
				_gl.uniform1i( this.blBackPrgData.uBackColorBuffer, offsetBack + _backColorTexUnitOffset );

				_drawInBufferToOutBuffer();

			} catch (err) {
				console.error( err );
			}

			popCurrentProgram( );

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
				label: 'testFlag (' + _debugNumDepthPeelingPasses + '): depth ' + (id == _readId ? 'read' : 'write')
			} );

		}

		function drawFrontColorBufferToScreen ( id, flagChanged ) {

			var pingPongOffset = id * 3;
			_drawDebugBufferToScreen({
				flagChanged: flagChanged,
				testMode: 2,
				texUnit: pingPongOffset + _frontColorTexUnitOffset,
				label: 'testFlag (' + _debugNumDepthPeelingPasses + '): front ' + (id == _readId ? 'read' : 'write')
			} );

		}

		function _drawBackColorBufferToScreen(id, flagChanged ) {

			var pingPongOffset = id * 3;
			_drawDebugBufferToScreen({
				flagChanged: flagChanged,
				testMode: 2,
				texUnit: pingPongOffset + _backColorTexUnitOffset,
				label: 'testFlag (' + _debugNumDepthPeelingPasses + '): back ' + (id == _readId ? 'read' : 'write')
			} );

		};

		function _drawBlendBackBufferToScreen( flagChanged ) {

			_drawDebugBufferToScreen( {
				flagChanged: flagChanged,
				testMode: 2,
				texUnit: _blendBackTexUnit,
				label: 'testFlag (' + _debugNumDepthPeelingPasses + '): blendBack'
			} );

		};

		function endDrawLoopInner () {

			/*
			 IT IS STRONGLY RECOMMENDED that you leave the debugging code in place. It took many days of trial and error to find
			 this method and getting it working. Without it you are programming in the dark.

			 This allows you to view each buffer during the render. It's about the only way to view and
			 debug the depth peeling process.

			 If a future node.js/Electron/chromium update allows reading gl.FLOAT using readPixels, it should be replaced with a
			 real frame dump to disk image.

			 */

			// Depth peeling makes use of two non-standard, fixed programs that SHOULD NOT be logged as
			// the current program with WebGLState.
			// So, we push the current program and pop it on exit.

			const testFlagNormal = 0;
			const testFlagDrawFrontColorRead = 1;
			const testFlagDrawFrontColorWrite = 2;
			const testFlagDrawBackColorRead = 3;
			const testFlagDrawBackColorWrite = 4;
			const testFlagDrawDepthBufferRead = 5;
			const testFlagDrawDepthBufferWrite = 6;
			const testFlagDrawBlendBackBuffer = 7;

			const buffsToDraw = [
				testFlagNormal,
				testFlagDrawFrontColorRead,
				testFlagDrawFrontColorWrite,
				testFlagDrawBackColorRead,
				testFlagDrawBackColorWrite,
				testFlagDrawDepthBufferRead,
				testFlagDrawDepthBufferWrite,
				testFlagDrawBlendBackBuffer
			];

			if (_debugDrawBuffersDelay < 0) {

				_blendFinal();

			} else {

				var flagChanged = false;
				if (_testIndex === undefined) {

					_testTick = 0;
					_testIndex = 0;
					flagChanged = true;

				} else {

					_testTick++;
					if (_testTick > _debugDrawBuffersDelay) {

						_testTick = 0;
						_testIndex++;
						if (_testIndex >= buffsToDraw.length) {

							_testIndex = 0;
							_debugNumDepthPeelingPasses++;

						}
						flagChanged = true;

					}

				}

				var testFlag = buffsToDraw[_testIndex];
				if (testFlag === testFlagNormal) {

					if (flagChanged)
						console.warn('testFlag (' + _debugNumDepthPeelingPasses + '): normal');
					_blendFinal();

				} else if (testFlag === testFlagDrawFrontColorRead)
					drawFrontColorBufferToScreen(_readId, flagChanged);
				else if (testFlag === testFlagDrawFrontColorWrite)
					drawFrontColorBufferToScreen(_writeId, flagChanged);
				else if (testFlag === testFlagDrawBackColorRead)
					_drawBackColorBufferToScreen(_readId, flagChanged);
				else if (testFlag === testFlagDrawBackColorWrite)
					_drawBackColorBufferToScreen(_writeId, flagChanged);
				else if (testFlag === testFlagDrawDepthBufferRead)
					_drawDepthBufferToScreen(_readId, flagChanged);
				else if (testFlag === testFlagDrawDepthBufferWrite)
					_drawDepthBufferToScreen(_writeId, flagChanged);
				else if (testFlag === testFlagDrawBlendBackBuffer)
					_drawBlendBackBufferToScreen(flagChanged);

			}
		}

		this.endDrawLoop = function () {

			pushCurrentProgram();

			try {

				endDrawLoopInner();

			} catch ( err ) {
				console.error( err );
			}

			popCurrentProgram();

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
