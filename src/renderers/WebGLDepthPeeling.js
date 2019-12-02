import depthPeelingPrefixChunk from './shaders/ShaderChunk/depth_peeling_prefix.glsl.js';
import gammaFuncs from './shaders/ShaderChunk/depth_peeling_gamma_functions.glsl.js';
import depthPeelingMainPrefixChunk from './shaders/ShaderChunk/depth_peeling_main_prefix.glsl.js';
import depthPeelingMainSuffixChunk from './shaders/ShaderChunk/depth_peeling_main_suffix.glsl.js';

class WebGLDepthPeeling {

	constructor(renderer, numDepthPeelingPasses) {
		class ProgramData {

			constructor() {

				this.program = null;
				this.frontColorInLoc = null;
				this.uBackColorBuffer = null;

			}

		}

		var _this = this;

		this.renderer = renderer;
		var _gl = undefined; // Can't initialize this until later in the process, but need to declare it here.
		const _depthTexUnitOffset = 0,
					_frontColorTexUnitOffset = 1,
					_backColorTexUnitOffset = 2,
					_blendBackTexUnit = 6;
		this.initialized = false;
		this.depthPeelingRender = true; // internal flag used to control type of render
		this.numDepthPeelingPasses = numDepthPeelingPasses;
		this.readId = 0;
		this.writeId = 1;

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

		this.prepareDbBuffers = function ( camera ) {

			if ( _gl === undefined )
				_gl = this.renderer.context;

			this.initBuffers_();
			this.resizeBuffers( _gl.drawingBufferWidth, _gl.drawingBufferHeight );

			_gl.enable( _gl.BLEND );
			_gl.disable( _gl.DEPTH_TEST );
			_gl.enable( _gl.CULL_FACE );
		};

		this.initBuffers_ = function () {

			if ( this.initialized )
				return;

			_gl.getExtension( "EXT_color_buffer_float" );

			this.createBuffers_();
			this.setupShaders_();
			this.initialized = true;

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
			this.finPrgData.frontColorInLoc = _gl.getUniformLocation( this.finPrgData.program, "frontColorIn" );
			this.finPrgData.uBackColorBuffer = _gl.getUniformLocation( this.finPrgData.program, "uBackColorBuffer" );

		};

		var quadBuffer_;
		var numQuadVertices_;
		function setupQuads_() {

			// Quad for draw pass
			var quadVertices = new Float32Array( [
				- 1,   1, - 1, - 1, 1, - 1,
				- 1,   1,   1, - 1, 1,   1
			] );

			numQuadVertices_ = quadVertices.length / 2;
			quadBuffer_ = _gl.createBuffer();
			_gl.bindBuffer( _gl.ARRAY_BUFFER, quadBuffer_ );
			_gl.bufferData( _gl.ARRAY_BUFFER, quadVertices, _gl.STATIC_DRAW );

		};

		function drawInBufferToOutBuffer_() {

			// Draws the shader input(s) to the output buffer by rendering a full screen
			// quad (2 triangles)
			_gl.bindBuffer( _gl.ARRAY_BUFFER, quadBuffer_ );
			_gl.vertexAttribPointer( 0, 2, _gl.FLOAT, false, 0, 0 );

			_gl.drawArrays( _gl.TRIANGLES, 0, numQuadVertices_ );

		};

		this.createBuffers_ = function () {

			// 2 for ping-pong
			// COLOR_ATTACHMENT0 - front color
			// COLOR_ATTACHMENT1 - back color
			this.depthBuffers = [_gl.createFramebuffer(), _gl.createFramebuffer()];
			this.colorBuffers = [_gl.createFramebuffer(), _gl.createFramebuffer()];
			this.blendBackBuffer = _gl.createFramebuffer();
			this.depthTarget = [_gl.createTexture(), _gl.createTexture()];
			this.frontColorTarget = [_gl.createTexture(), _gl.createTexture()];
			this.backColorTarget = [_gl.createTexture(), _gl.createTexture()];
			this.blendBackTarget = _gl.createTexture();
			setupQuads_();

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

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _this.colorBuffers[ pingPongIndex ] );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0, _gl.TEXTURE_2D, _this.frontColorTarget[ pingPongIndex ], 0 );
			_gl.framebufferTexture2D( _gl.FRAMEBUFFER, _gl.COLOR_ATTACHMENT0 + 1, _gl.TEXTURE_2D, _this.backColorTarget [ pingPongIndex ], 0 );
			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		function resizeDepthBuffers_ ( pingPongIndex ) {

			var texOffset = pingPongIndex * 3;

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _this.depthBuffers[ pingPongIndex ] );
			resizeDepthBuffer_( texOffset, _depthTexUnitOffset, _this.depthTarget[ pingPongIndex ] );
			resizeColorBuffer_( texOffset, 1, _this.frontColorTarget[ pingPongIndex ] );
			resizeColorBuffer_( texOffset, 2, _this.backColorTarget[ pingPongIndex ] );

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, null );

		}

		function resizeBackBuffer_ () {

			_gl.bindFramebuffer( _gl.FRAMEBUFFER, _this.blendBackBuffer );
			resizeBuffer_( {
				texUnit: 6,
				texture: _this.blendBackTarget,
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
			_gl.bindTexture(_gl.TEXTURE_2D, this.depthTarget[0]);

			_gl.activeTexture(_gl.TEXTURE0 + 0 + _frontColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, this.frontColorTarget[0]);

			_gl.activeTexture(_gl.TEXTURE0 + 0 + _backColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, this.backColorTarget[0]);

			_gl.activeTexture(_gl.TEXTURE0 + 3 + _depthTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, this.depthTarget[1]);

			_gl.activeTexture(_gl.TEXTURE0 + 3 + _frontColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, this.frontColorTarget[1]);

			_gl.activeTexture(_gl.TEXTURE0 + 3 + _backColorTexUnitOffset);
			_gl.bindTexture(_gl.TEXTURE_2D, this.backColorTarget[1]);

			_gl.activeTexture( _gl.TEXTURE0 + _blendBackTexUnit );
			_gl.bindTexture( _gl.TEXTURE_2D, this.blendBackTarget );

		};

		function clearBuffersForDraw_ ( init ) {

			const DEPTH_CLEAR_VALUE = -99999.0;
			const MAX_DEPTH_ = 1.0; // furthest
			const MIN_DEPTH_ = 0.0; // nearest

			_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.depthBuffers[this.writeId]);
			_gl.clearColor(DEPTH_CLEAR_VALUE, DEPTH_CLEAR_VALUE, 0, 0);
			_gl.clear(_gl.COLOR_BUFFER_BIT);

			_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.colorBuffers[this.writeId]);
			_gl.clearColor(0, 0, 0, 0);
			_gl.clear(_gl.COLOR_BUFFER_BIT);

			if (init) {
				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.depthBuffers[this.readId]);
				_gl.clearColor(-MIN_DEPTH_, MAX_DEPTH_, 0, 0);
				_gl.clear(_gl.COLOR_BUFFER_BIT);

				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.colorBuffers[this.readId]);
				_gl.clearColor(0, 0, 0, 0);
				_gl.clear(_gl.COLOR_BUFFER_BIT);
			}

			_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.blendBackBuffer);
			_gl.clearColor(0, 0, 0, 0);
			_gl.clear(_gl.COLOR_BUFFER_BIT);

		};

		this.beginPass = function( passNum ) {
			this.passNum = passNum;
			this.readId = passNum % 2;
			this.writeId = 1 - this.readId;
			initializeBuffersForPass_();
			clearBuffersForDraw_(passNum === 0);
		};

		this.bindBuffersForDraw = function ( tjsProgram ) {

			if (tjsProgram && tjsProgram.program && this.isDepthPeelingOn()) {
				var program = tjsProgram.program;

/*
				// Clear input color buffer test - passes. This test changes the color of the next pass
				_gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.colorBuffers[this.readId]);
				_gl.drawBuffers([_gl.COLOR_ATTACHMENT0, _gl.COLOR_ATTACHMENT0 + 1]);
				_gl.clearColor(0, 1, 0, 0.5);
				_gl.clear(_gl.COLOR_BUFFER_BIT);
*/

				var offsetRead = 3 * this.readId;

				_gl.bindFramebuffer( _gl.DRAW_FRAMEBUFFER, this.depthBuffers[ this.writeId ] );
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

		this.blendBack = function ( gl ) {

			var offsetBack = this.writeId * 3;
			_gl.bindFramebuffer( _gl.DRAW_FRAMEBUFFER, this.blendBackBuffer );
			_gl.drawBuffers( [ _gl.COLOR_ATTACHMENT0 ] );
			_gl.blendEquation( _gl.FUNC_ADD );
			_gl.blendFuncSeparate( _gl.SRC_ALPHA, _gl.ONE_MINUS_SRC_ALPHA, _gl.ONE, _gl.ONE_MINUS_SRC_ALPHA );
/*
			// buffer testing. This test passes also, the screen background turns blue
			_gl.clearColor(0, 0, 1, 0.5);
			_gl.clear(_gl.COLOR_BUFFER_BIT);
*/

			_gl.useProgram( this.blBackPrgData.program );
			var backColorLoc = _gl.getUniformLocation( this.blBackPrgData.program, "uBackColorBuffer" );
			_gl.uniform1i( backColorLoc, offsetBack + _backColorTexUnitOffset ); // Read from back color

			drawInBufferToOutBuffer_();

		};

		this.blendFinal = function ( gl, writeId ) {
/*
			 // buffer testing
			 _gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.colorBuffers[this.writeId]);
			 _gl.clearColor(1, 0, 0, 0.5);
			 _gl.clear(_gl.COLOR_BUFFER_BIT);

			 _gl.bindFramebuffer(_gl.DRAW_FRAMEBUFFER, this.blendBackBuffer);
			 _gl.clearColor(0, 1, 0, 0.5);
			 _gl.clear(_gl.COLOR_BUFFER_BIT);
*/
			let offsetBack = this.writeId * 3;
			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(this.finPrgData.program);

			var testModeLoc = _gl.getUniformLocation( this.finPrgData.program, "testMode" );
			_gl.uniform1i(testModeLoc, 0); // set shader to normal mode

			var frontColorInLoc = _gl.getUniformLocation( this.finPrgData.program, "frontColorIn" );
			_gl.uniform1i(frontColorInLoc, offsetBack + 1); // Read from front color buffer

			var uBackColorBuffer = _gl.getUniformLocation( this.finPrgData.program, "uBackColorBuffer" );
			_gl.uniform1i(uBackColorBuffer, _blendBackTexUnit); // Read from blend back buffer

			drawInBufferToOutBuffer_();

		};

		this.drawDepthBufferToScreen_ = function ( gl, id, flagChanged ) {
			if (flagChanged) {
				var testStr = 'depth ' + (id == this.readId ? 'read' : 'write');
				console.warn('testFlag: ' + testStr);
			}

			let offsetBack = id * 3;
			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(this.finPrgData.program);

			var testModeLoc = _gl.getUniformLocation( this.finPrgData.program, "testMode" );
			_gl.uniform1i(testModeLoc, 1 ); // Set shader to depth buffer test mode

			var frontColorInLoc = _gl.getUniformLocation( this.finPrgData.program, "frontColorIn" );
			_gl.uniform1i(frontColorInLoc, offsetBack + _depthTexUnitOffset); // Read from front color buffer

			drawInBufferToOutBuffer_();
		};

		this.drawFrontColorBufferToScreen_ = function ( _gl, id, flagChanged ) {
			if (flagChanged) {
				var testStr = 'front ' + (id == this.readId ? 'read' : 'write');
				console.warn('testFlag: ' + testStr);
			}

			let offsetBack = id * 3;
			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(this.finPrgData.program);

			var testModeLoc = _gl.getUniformLocation( this.finPrgData.program, "testMode" );
			_gl.uniform1i(testModeLoc, 2 ); // Set shader to general test mode

			var frontColorInLoc = _gl.getUniformLocation( this.finPrgData.program, "frontColorIn" );
			_gl.uniform1i(frontColorInLoc, offsetBack + _frontColorTexUnitOffset); // Read from front color buffer

			drawInBufferToOutBuffer_();
		};

		this.drawBackColorBufferToScreen_ = function ( gl, id, flagChanged ) {
			if (flagChanged) {
				var testStr = 'back ' + (id == this.readId ? 'read' : 'write');
				console.warn('testFlag: ' + testStr);
			}

			let offsetBack = id * 3;
			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(this.finPrgData.program);

			var testModeLoc = _gl.getUniformLocation( this.finPrgData.program, "testMode" );
			_gl.uniform1i(testModeLoc, 2); // Set shader to general test mode

			var frontColorInLoc = _gl.getUniformLocation( this.finPrgData.program, "frontColorIn" );
			_gl.uniform1i(frontColorInLoc, offsetBack + _backColorTexUnitOffset); // Read from back color buffer

			drawInBufferToOutBuffer_();
		};

		this.drawBlendBackBufferToScreen_ = function ( gl, flagChanged ) {
			if (flagChanged) {
				console.warn('testFlag: back');
			}

			_gl.bindFramebuffer(_gl.FRAMEBUFFER, null);
			_gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

			_gl.useProgram(this.finPrgData.program);

			var testModeLoc = _gl.getUniformLocation( this.finPrgData.program, "testMode" );
			_gl.uniform1i(testModeLoc, 2); // Set shader to general test mode

			var uBackColorBuffer = _gl.getUniformLocation( this.finPrgData.program, "uBackColorBuffer" );
			_gl.uniform1i(uBackColorBuffer, _blendBackTexUnit); // Read from blend back buffer

			drawInBufferToOutBuffer_();
		};

		this.dispose = function ( ) {

			console.warn('WebGLDepthPeeling.dispose is not tested yet.');

			if (this.blendBackBuffer) {
				_gl.deleteFramebuffer(this.blendBackBuffer);
				this.blendBackBuffer = null;
			}

			if (this.depthTarget) {
				_gl.deleteTexture(this.depthTarget[0]);
				_gl.deleteTexture(this.depthTarget[1]);
				this.depthTarget = null;
			}

			if (this.frontColorTarget) {
				_gl.deleteTexture(this.frontColorTarget[0]);
				_gl.deleteTexture(this.frontColorTarget[1]);
				this.frontColorTarget = null;
			}

			if (this.backColorTarget) {
				_gl.deleteTexture(this.backColorTarget[0]);
				_gl.deleteTexture(this.backColorTarget[1]);
				this.backColorTarget = null;
			}

			if (this.blendBackTarget) {
				_gl.deleteTexture(this.blendBackTarget);
				this.blendBackTarget = null;
			}
		};

	};

}

export { WebGLDepthPeeling };
