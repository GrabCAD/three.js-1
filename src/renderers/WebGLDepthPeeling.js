import { CullFaceNone } from '../constants';
import { WebGLErrorReporter } from './webgl/WebGLErrorReporter';
import { WebGLDPBuffers, DPTestFlags } from './webgl/WebGLDepthPeelingBuffer';
import depthPeelingPrefixChunk from './shaders/ShaderChunk/depth_peeling_prefix.glsl';
import gammaFuncs from './shaders/ShaderChunk/depth_peeling_gamma_functions.glsl';
import depthPeelingMainPrefixChunk from './shaders/ShaderChunk/depth_peeling_main_prefix.glsl';
import depthPeelingMainSuffixChunk from './shaders/ShaderChunk/depth_peeling_main_suffix.glsl';
import srcVertexShaderQuad from './shaders/ShaderChunk/depth_peeling_quad_vertex_shader.glsl';
import srcFragmentShaderBlendBack from './shaders/ShaderChunk/depth_peeling_fragment_blend_back.glsl';
import srcFragmentShaderFinal0 from './shaders/ShaderChunk/depth_peeling_fragment_final_0.glsl';
import srcFragmentShaderFinal1 from './shaders/ShaderChunk/depth_peeling_fragment_final_1.glsl';

import Preprocessor from '@andrewray/glsl-preprocessor';
import Jimp from 'jimp';
import {fs} from 'fs';

class WebGLDepthPeeling {

	constructor(renderer, numDepthPeelingPasses) {
		// Debugging options. See implementation for details.

		// The following controls with buffers to render to the screen if _debugDrawBuffersDelay > 0
		const fps = 30;
		const captureInterval = 5; // seconds
		const _debugDrawBuffersDelay = captureInterval * fps;

		const testFlags = new DPTestFlags();

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
			_dpBuffers,
			_quadBuffer,
			_numQuadVertices,
			_readId = 0,
			_writeId = 1,
			_dpPass = -1,
			_testTick = 0,
			_passFrames = null,
			_passFrameIndices,
			_passNum = 0;

		this.renderer = _renderer;

		function log( str ) {
			if ( _passFrames ) {

				console.warn( 'pass#:' + _passNum + ' : ' + str);

			}
		}
		this.log = log;

		this.getNumDepthPeelingPasses = function () {
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

		var _preProc = new Preprocessor();
		function dumpShaderSource( prefix, source ) {

			const dumpSource = false;
			if ( dumpSource && _this.isDepthPeelingOn() ) {

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

		this.modifyVertexShader = function ( material, vertexGlsl ) {

			return vertexGlsl;

		};

		this.modifyFragmentShader = function ( material, fragmentGlsl, vertexGlsl ) {

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
			fragmentGlsl = fragmentGlsl.substring(0, fragmentGlsl.length - 1);
			fragmentGlsl = fragmentGlsl + '\n' + fragmentGlslSuffix + '\n}';

			var procFrag = _preProc.preprocess(fragmentGlsl);
			var procVert = _preProc.preprocess(vertexGlsl);

			const faceStatusStr = 'float fragFaceStatus = DP_FACE_STATUS_NONE;';
			if (depthPeelingEnabled && fragmentGlsl.indexOf(faceStatusStr) !== -1) {
				var replaceStr = `
float fragFaceStatus = DP_FACE_STATUS_NONE;
`;
				fragmentGlsl = fragmentGlsl.replace(faceStatusStr, replaceStr);
			}


			return fragmentGlsl;
		};

		function setupQuads() {

			// Quad for draw pass
			var quadVertices = new Float32Array( [
				- 1,   1, - 1, - 1, 1, - 1,
				- 1,   1,   1, - 1, 1,   1
			] );

			_numQuadVertices = quadVertices.length / 2;
			_quadBuffer = _gl.createBuffer();
			_gl.bindBuffer( _gl.ARRAY_BUFFER, _quadBuffer );
			_gl.bufferData( _gl.ARRAY_BUFFER, quadVertices, _gl.STATIC_DRAW );

		}

		function drawInBufferToOutBuffer() {

			// Draws the shader input(s) to the output buffer by rendering a full screen
			// quad (2 triangles)
			_gl.bindBuffer( _gl.ARRAY_BUFFER, _quadBuffer );
			_gl.vertexAttribPointer( 0, 2, _gl.FLOAT, false, 0, 0 );

			_gl.drawArrays( _gl.TRIANGLES, 0, _numQuadVertices );

		}

		function createBuffers () {

			_dpBuffers = new WebGLDPBuffers( _this );
			setupQuads();

		}

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

			createBuffers();
			_this.setupShaders_();
			_this.initialized = true;

		}

		this.beginDrawLoop = function ( ) {

			initBuffers();

			// Special handling of the error wrapper
			var rawGl = ( _gl instanceof WebGLErrorReporter ) ? _gl.gl : _gl;
			this.resizeBuffers( rawGl.drawingBufferWidth, rawGl.drawingBufferHeight );

			_passNum = -1; // beginDrawPass will increment this to zero on the first pass

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

		function resizeBuffer_ ( params ) {
			_dpBuffers.resizeBuffer (params);
		}

		this.resizeBuffers = function ( width, height ) {

			if ( needToResizeBuffers(width, height) ) {

				_dpBuffers.resize( _this.bufferSize );
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

		this.endDrawPass = function () {

			pushCurrentProgram();

			try {

				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, _dpBuffers.getBlendBackBuffer() );
				_gl.blendEquation( _gl.FUNC_ADD );
				_gl.blendFuncSeparate( _gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA, _gl.ONE, _gl.ONE_MINUS_SRC_ALPHA );

				_gl.useProgram( this.blBackPrgData.program );
				_gl.uniform1i( this.blBackPrgData.uBackColorBuffer, _dpBuffers.getBackColorTextureUnitID() );

				drawInBufferToOutBuffer();

				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, null );

				saveFrameBuffersForWriting();

			} catch (err) {
				console.error( err );
			}

			popCurrentProgram( );

		};

		function blendFinal() {

			var pingPongOffset = _writeId * 3;
			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(_this.finPrgData.program);
			_gl.uniform1i(_this.finPrgData.frontColorInLoc, _dpBuffers.getFrontColorTextureUnitID()); // Read from front color buffer
			_gl.uniform1i(_this.finPrgData.uBackColorBuffer, _dpBuffers.getBlendTextureUnitID()); // Read from blend back buffer
			_gl.uniform1i(_this.finPrgData.testModeLoc, -1); // set shader to normal mode

			drawInBufferToOutBuffer();

		}

		var _toDiskBuffer;
		var _toDiskTarget;

		function getImageString ( params ) {
			switch ( params.bufferId ) {
				case testFlags.drawFrontColor:
					return "front";

				case testFlags.drawBackColor:
					return "back";

				case testFlags.drawDepthNear:
					return "depth_near";

				case testFlags.drawDepthFar:
					return "depth_far";

				case testFlags.drawDepthBack:
					return "depth_back";

				case testFlags.drawBlendBack:
					return "blend";

				default:
					return "???";

			}

		}

		function getReadWriteString ( params ) {

			return params.mode;

		}

		function dumpAvgRange( filename, pixels, channel ) {

			if (filename.indexOf('depth') === -1)
				return;

			var i, j, min = 1.0, max = -1.0;
			const entries = pixels.length / 4;

			for (i = 0; i < entries; i++) {
				var val = pixels[4 * i + channel];
				if (val === 0 || val === 255)
					continue;

				val = val / 255.0;
				if (val < min)
					min = val;
				if (val > max)
					max = val;
			}
			var str;
			if (max === -1) {
				str = 'Min/max data for ' + filename + ' all zeros';
			} else {
				var average = (min + max) / 2;
				var range = (max - min);
				str = '\n      Min/max data for ' + filename + ': average = ' + average + ', range = ' + range;
			}
			log(str);
		}

		function dumpHistogram( filename, pixels, channel ) {
			if (filename.indexOf('depth') === -1)
				return;
			var i, j;
			const entries = pixels.length / 4;
			var hist = [
			];
			const numBins = 20;
				for (j = 0; j <= numBins; j++) {
					hist.push( 0 );
			}

			for (i = 0; i < entries; i++) {

				var val = pixels[4 * i + channel] / 255.0;
				var binIdx = Math.trunc(numBins * val + 0.5);
				hist[binIdx]++;

			}

			var str = '\n      Min/max data for ' + filename + '\n      ';
			const ch = ['r', 'g', 'b', 'a'];
			str += ch[channel] + '[';
			for (i = 0; i < hist.length; i++ ) {
				str += (hist[i] / entries);
				if ( i != hist.length - 1 )
					str += ', ';
			}
			str += ']';

			log(str);
		}

		function captureImageForDump( params) {

			if (!_toDiskBuffer) {

				_toDiskBuffer = _gl.createFramebuffer();
				_toDiskTarget = _gl.createTexture();

				_gl.activeTexture(_gl.TEXTURE0);
				_gl.bindTexture(_gl.TEXTURE_2D, _toDiskTarget);
				_gl.bindFramebuffer(_gl.FRAMEBUFFER, _toDiskBuffer);
				_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0 ] );

				resizeBuffer_({
					textureUnitId: 0,
					texture: _toDiskTarget,
					internalFormat: _gl.RGBA
				});

				_dpBuffers.checkFrameBuffer();
			}

			_gl.bindFramebuffer(_gl.FRAMEBUFFER, _toDiskBuffer);
			_gl.disable(_gl.BLEND);

			_gl.activeTexture(_gl.TEXTURE1);
			_gl.bindTexture(_gl.TEXTURE_2D, params.texture);

			_gl.useProgram(_this.finPrgData.program);
			_gl.uniform1i(_this.finPrgData.testModeLoc, params.testMode);
			_gl.uniform1i(_this.finPrgData.frontColorInLoc, 1);

			drawInBufferToOutBuffer();

			var path = 'C:/Users/robert.tipton/Documents/Models/Output/DepthPeelingOut/';
			var imageStr = getImageString( params );
			var readWriteStr = getReadWriteString( params );

			var filename = path + imageStr + '/p_' + _passNum + '_' + readWriteStr + '.png';
			var pixels = new Uint8Array(_this.bufferSize.width * _this.bufferSize.height * 4);


			_gl.readPixels(0, 0, _this.bufferSize.width, _this.bufferSize.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

			dumpAvgRange(filename, pixels, 0);
			dumpHistogram(filename, pixels, 0);

			const frameId = params.bufferId + '_' + params.mode;
			if ( !_passFrames [ _passNum ] ) {
				_passFrames [ _passNum ] = [];
			}
			var frameData = _passFrames [ _passNum ];

			if (!_passFrameIndices) {
				_passFrameIndices = {};
			}
			var frameIndex = -1;
			if ( _passFrameIndices.hasOwnProperty(frameId)) {
				frameIndex = _passFrameIndices[frameId];
			} else {
				frameIndex = Object.getOwnPropertyNames(_passFrameIndices).length;
				_passFrameIndices[frameId] = frameIndex;
			}

			frameData[frameIndex] = {
				filename: filename,
				pixels: pixels
			};


			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null );

		}

		function writeFrameDataToDisk() {

			console.warn('Writing depth peeling frames.');
			var imageDataToWrite = [];

			_passFrames.forEach(function (frameData) {

				frameData.forEach(function (imageData) {
					imageDataToWrite.push(imageData);
				});
			});

			writeImagesToDisk( imageDataToWrite );
		}

		function writeImagesToDisk(imageDataToWrite) {
			var imageData = imageDataToWrite.pop();
			if (imageData) {

				const width = _this.bufferSize.width;
				const height = _this.bufferSize.height;
				var pixels = imageData.pixels;
				const dataWidth = width * 4;
				for (var y = 0; y < height / 2; y++ ) {
					for (var x = 0; x < dataWidth; x++ ) {
						var tmp = pixels[y * dataWidth + x];
						pixels[y * dataWidth + x] = pixels[(height - 1 - y) * dataWidth + x];
						pixels[(height - 1 - y) * dataWidth + x] = tmp;
					}
				}

				let image = new Jimp(1, 1);
				image.bitmap.data = pixels;
				image.bitmap.width = width;
				image.bitmap.height = height;

				image.write( imageData.filename, ( err ) => {
					if (err) {
						throw err;
					}
					image = undefined;
					writeImagesToDisk( imageDataToWrite );
				});

			} else {
				console.warn( 'All depth peeling frames written to disk');
			}

		}

		function saveFrameBuffersForWriting() {

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
			if ( _passFrames ) {

				_passFrames[ _passNum ] = [];
				_dpBuffers.getAllFrames( captureImageForDump );

			}

		}

		this.beginDrawPass = function() {

			_passNum++;
			_readId = _passNum % 2;
			_writeId = 1 - _readId;

			if ( ( _debugDrawBuffersDelay > 0 ) && ( _passNum === 0 ) && ( _testTick++ >= _debugDrawBuffersDelay ) ) {
				_passFrames = new Array( this.numDepthPeelingPasses );
				log('Capturing depth peeling frames');
				_testTick = 0;
			}
			_dpBuffers.beginDrawPass( _passNum, null ); // _passFrames ? captureImageForDump : null );

			/*
			 bindDepthBufferTextures();
			 clearBuffersForDraw_(_passNum === 0);
			 */
		};

		this.bindBuffersForDraw = function ( ) {

			if (this.isDepthPeelingOn()) {
				_dpBuffers.bindBuffersForDraw();

				_gl.blendEquation( _gl.MAX );
				_state.enable( _gl.BLEND );
				_state.disable( _gl.DEPTH_TEST );
				_state.setCullFace( CullFaceNone );

			}

		};

		this.endDrawLoop = function ( renderTarget ) {

			pushCurrentProgram();

			try {

				blendFinal();

			} catch ( err ) {
				console.error( err );
			}

			popCurrentProgram();

			if ( _passFrames ) {
				writeFrameDataToDisk();
				_passFrames = undefined;
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
