class WebGLDepthPeeling {

	constructor(renderer, numDepthPeelingPasses) {
		class ProgramData {

			constructor() {

				this.program = null;
				this.uColorBuffer = null;
				this.uBackColorBuffer = null;

			}

		}

		this.renderer = renderer;

		this.dpInitialized = false;
		this.depthPeelingRender = true; // internal flag used to control type of render
		this.numDepthPeelingPasses = numDepthPeelingPasses;
		this.readId = 0;
		this.writeId = 1;

		this.prepareDbBuffers_ = function ( camera ) {

			var gl = this.renderer.context;

			this.initBuffers_( gl );
			this.resizeBuffers_( gl );

			gl.useProgram( this.dpFinPrgData.program );
			gl.uniform1i( this.dpFinPrgData.uBackColorBuffer, 6 );

			gl.enable( gl.BLEND );
			gl.disable( gl.DEPTH_TEST );
			gl.enable( gl.CULL_FACE );
		};

		this.initializeBuffersForPass_ = function ( gl ) {

			gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.blendBackBuffer );
			gl.clearColor( 0, 0, 0, 0 );
			gl.clear( gl.COLOR_BUFFER_BIT );

			for ( var i = 0; i < 2; i ++ ) {

				var o = i * 3;

				gl.activeTexture( this.depthOffset + o );
				gl.bindTexture( gl.TEXTURE_2D, this.depthTarget[ i ] );

				gl.activeTexture( this.frontColorOffset + o );
				gl.bindTexture( gl.TEXTURE_2D, this.frontColorTarget[ i ] );

				gl.activeTexture( this.backColorOffset + o );
				gl.bindTexture( gl.TEXTURE_2D, this.backColorTarget[ i ] );

			}

			gl.activeTexture( gl.TEXTURE0 + 6 );
			gl.bindTexture( gl.TEXTURE_2D, this.blendBackTarget );

		};

		this.initBuffers_ = function ( gl ) {

			if ( this.dpInitialized ) return;

			gl.getExtension( "EXT_color_buffer_float" );

			this.setupShaders_( gl );
			this.initDpBuffers_( gl );
			this.setupQuad_( gl );
			this.dpInitialized = true;

		};

		this.setupShaders_ = function ( gl ) {

			var gammaFuncs = `
		// We are doing our own blending between different depth layers.
		// For most graphics purposes, depth peeling can ignore this, for HQ color we should not.
		//
		// From literature, the video card does automatic gamma correction during blending, 
		// but we're not using the card. So, we do our own gamma correction. See 
		// https://blog.johnnovak.net/2016/09/21/what-every-coder-should-know-about-gamma/
		
		#if 1 // This definitely seems the correct approach, the other option is retained for future comparison if anyone
				// else wants to test it.
			// gamma corrected
			float lin(float inVal)
			{
				float gamma = 2.2;
				return pow(inVal, gamma);
			}
			
			vec3 lin(vec3 inVal)
			{
				return vec3(lin(inVal.r), lin(inVal.g), lin(inVal.b));
			}

			float nonLin(float inVal)
			{
				float gammaInv = 1.0 / 2.2;
				return pow(inVal, gammaInv);
			}

			vec3 nonLin(vec3 inVal)
			{
				return vec3(
					nonLin(inVal.r), 
					nonLin(inVal.g), 
					nonLin(inVal.b)
				);
			}
		#else
			// Non gamma corrected, for comparison
			float lin(float inVal)
			{
				return inVal;
			}
			
			vec3 lin(vec3 inVal)
			{
				return inVal;
			}

			float nonLin(float inVal)
			{
				return inVal;
			}

			vec3 nonLin(vec3 inVal)
			{
				return inVal;
			}
		#endif
		`;

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
			uniform sampler2D uColorBuffer;
			uniform sampler2D uBackColorBuffer;

			` +
				gammaFuncs +
				`
			
			out vec4 fragColor;
			void main() {
				// Blend final, needs gamma correction
				// See more complete description in peeling fragment shader

				ivec2 fragCoord = ivec2(gl_FragCoord.xy);
				vec4 frontColor = texelFetch(uColorBuffer, fragCoord, 0);
				vec4 backColor = texelFetch(uBackColorBuffer, fragCoord, 0);
				float alphaMultiplier = 1.0 - lin(frontColor.a);

				vec3 color = nonLin(lin(frontColor.rgb) + alphaMultiplier * lin(backColor.rgb));


				fragColor = vec4(
					color,
					nonLin(lin(frontColor.a) + lin(backColor.a))
				);
			}
		`;

			function createShader( type, source, name ) {

				var shader = gl.createShader( type );
				gl.shaderSource( shader, source );
				gl.compileShader( shader );
				if ( ! gl.getShaderParameter( shader, gl.COMPILE_STATUS ) ) {

					console.error( "Shader compile error in " + name );
					console.error( gl.getShaderInfoLog( shader ) );
					console.log( source );

				}
				return shader;

			}

			function createProgram(
				vertShader,
				fragShader,
				name
			) {

				var program = gl.createProgram();
				gl.attachShader( program, vertShader );
				gl.attachShader( program, fragShader );
				gl.linkProgram( program );
				if ( ! gl.getProgramParameter( program, gl.LINK_STATUS ) ) {

					console.error( "Shader compile error in " + name );
					console.error( gl.getProgramInfoLog( program ) );

				}
				return program;

			}

			var fullScreenQuadVertexShader = createShader(
				gl.VERTEX_SHADER,
				srcVertexShaderQuad,
				"vertexShaderQuad"
			);
			var finalFragmentShader = createShader(
				gl.FRAGMENT_SHADER,
				srcFragmentShaderFinal,
				"fragmentShaderFinal"
			);
			var blendBackFragmentShader = createShader(
				gl.FRAGMENT_SHADER,
				srcFragmentShaderBlendBack,
				"fragmentShaderBlendBack"
			);

			this.dpBlBackPrgData = new ProgramData();
			this.dpFinPrgData = new ProgramData();

			this.dpBlBackPrgData.program = createProgram( fullScreenQuadVertexShader, blendBackFragmentShader, "dpBlBackPrgData" );
			this.dpBlBackPrgData.uBackColorBuffer = gl.getUniformLocation( this.dpBlBackPrgData.program, "uBackColorBuffer" );

			this.dpFinPrgData.program = createProgram( fullScreenQuadVertexShader, finalFragmentShader, "dpFinPrgData" );
			this.dpFinPrgData.uColorBuffer = gl.getUniformLocation( this.dpFinPrgData.program, "uColorBuffer" );
			this.dpFinPrgData.uBackColorBuffer = gl.getUniformLocation( this.dpFinPrgData.program, "uBackColorBuffer" );

		};

		this.bufferSize = {
			width: 0,
			height: 0
		};

		this.initDpBuffers_ = function ( gl ) {

			this.dpDepthBuffers = [gl.createFramebuffer(), gl.createFramebuffer()];

			// 2 for ping-pong
			// COLOR_ATTACHMENT0 - front color
			// COLOR_ATTACHMENT1 - back color
			this.colorBuffers = [gl.createFramebuffer(), gl.createFramebuffer()];

			this.blendBackBuffer = gl.createFramebuffer();

			this.depthTarget = [gl.createTexture(), gl.createTexture()];
			this.frontColorTarget = [gl.createTexture(), gl.createTexture()];
			this.backColorTarget = [gl.createTexture(), gl.createTexture()];

			this.blendBackTarget = gl.createTexture();

			this.depthOffset = gl.TEXTURE0;
			this.frontColorOffset = this.depthOffset + 1;
			this.backColorOffset = this.depthOffset + 2;

		};

		this.resizeBuffers_ = function ( gl ) {
			if (this.bufferSize &&
				gl.drawingBufferWidth === this.bufferSize.width &&
				gl.drawingBufferHeight === this.bufferSize.height) {
				return;
			}

			this.bufferSize = {
				width: gl.drawingBufferWidth,
				height: gl.drawingBufferHeight
			};

			for ( var i = 0; i < 2; i ++ ) {

				var o = i * 3;

				gl.bindFramebuffer( gl.FRAMEBUFFER, this.dpDepthBuffers[ i ] );

				// These constants cause warnings in npm run build
				var RG32F = 0x8230;
				var RG = 0x8227;

				gl.activeTexture( this.depthOffset + o );
				gl.bindTexture( gl.TEXTURE_2D, this.depthTarget[ i ] );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					RG32F,
					this.bufferSize.width,
					this.bufferSize.height,
					0,
					RG,
					gl.FLOAT,
					null
				);
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0,
					gl.TEXTURE_2D,
					this.depthTarget[ i ],
					0
				);

				gl.activeTexture( this.frontColorOffset + o );
				gl.bindTexture( gl.TEXTURE_2D, this.frontColorTarget[ i ] );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA16F,
					this.bufferSize.width,
					this.bufferSize.height,
					0,
					gl.RGBA,
					gl.HALF_FLOAT,
					null
				);
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0 + 1,
					gl.TEXTURE_2D,
					this.frontColorTarget[ i ],
					0
				);

				gl.activeTexture( this.backColorOffset + o );
				gl.bindTexture( gl.TEXTURE_2D, this.backColorTarget[ i ] );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
				gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA16F,
					this.bufferSize.width,
					this.bufferSize.height,
					0,
					gl.RGBA,
					gl.HALF_FLOAT,
					null
				);
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0 + 2,
					gl.TEXTURE_2D,
					this.backColorTarget[ i ],
					0
				);

				gl.bindFramebuffer( gl.FRAMEBUFFER, this.colorBuffers[ i ] );

				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0,
					gl.TEXTURE_2D,
					this.frontColorTarget[ i ],
					0
				);
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0 + 1,
					gl.TEXTURE_2D,
					this.backColorTarget[ i ],
					0
				);

			}

			gl.bindFramebuffer( gl.FRAMEBUFFER, this.blendBackBuffer );
			gl.activeTexture( gl.TEXTURE0 + 6 );
			gl.bindTexture( gl.TEXTURE_2D, this.blendBackTarget );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA16F,
				this.bufferSize.width,
				this.bufferSize.height,
				0,
				gl.RGBA,
				gl.HALF_FLOAT,
				null
			);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				this.blendBackTarget,
				0
			);
			gl.bindFramebuffer( gl.FRAMEBUFFER, null );

		};

		this.setupQuad_ = function ( gl ) {

			// Quad for draw pass
			var quadVertices = new Float32Array( [
				- 1,   1,
				- 1, - 1,
				1, - 1,

				- 1,   1,
				1, - 1,
				1,   1 ] );
			this.quadBuffer = gl.createBuffer();
			gl.bindBuffer( gl.ARRAY_BUFFER, this.quadBuffer );
			gl.bufferData( gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW );

		};

		this.clearBuffersForDraw_ = function ( gl, readId, writeId, init ) {

			var DEPTH_CLEAR_VALUE = - 99999.0;
			var MAX_DEPTH_ = 1.0; // furthest
			var MIN_DEPTH_ = 0.0; // nearest

			gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.dpDepthBuffers[ writeId ] );
			gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
			gl.clearColor( DEPTH_CLEAR_VALUE, DEPTH_CLEAR_VALUE, 0, 0 );
			gl.clear( gl.COLOR_BUFFER_BIT );

			gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.colorBuffers[ writeId ] );
			gl.drawBuffers( [ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT0 + 1 ] );
			gl.clearColor( 0, 0, 0, 0 );
			gl.clear( gl.COLOR_BUFFER_BIT );

			if ( init ) {

				gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.dpDepthBuffers[ readId ] );
				gl.clearColor( - MIN_DEPTH_, MAX_DEPTH_, 0, 0 );
				gl.clear( gl.COLOR_BUFFER_BIT );

				gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.colorBuffers[ readId ] );
				gl.clearColor( 0, 0, 0, 0 );
				gl.clear( gl.COLOR_BUFFER_BIT );

			}

		};

		this.bindBuffersForDraw_ = function ( program ) {

			if (this.isDepthPeelingOn()) {
				var gl = this.renderer.context;
				var offsetRead = 3 * this.readId;

				// Buffer bindings seem wrong, nothing is written to the backColorTexture

				gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.dpDepthBuffers[ this.writeId ] );
				gl.drawBuffers( [ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT0 + 1, gl.COLOR_ATTACHMENT0 + 2 ] );
				gl.blendEquation( gl.MAX );

				var uDepthBuffer = gl.getUniformLocation(program, "uDepthBuffer");
				var uColorBuffer = gl.getUniformLocation(program, "uColorBuffer");

				gl.uniform1i( uDepthBuffer, offsetRead );
				gl.uniform1i( uColorBuffer, offsetRead + 1 );
			}

		};

		this.blendBack_ = function ( gl, writeId ) {

			var offsetBack = writeId * 3;
			gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.blendBackBuffer );
			gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
			gl.blendEquation( gl.FUNC_ADD );
			gl.blendFuncSeparate( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA );
/*
			buffer testing
			gl.clearColor(1, 0, 0, 0.5);
			gl.clear(gl.COLOR_BUFFER_BIT);
*/

			gl.useProgram( this.dpBlBackPrgData.program );
			gl.uniform1i( this.dpBlBackPrgData.uBackColorBuffer, offsetBack + 2 );

			this.drawQuads_( gl );

		};

		this.blendFinal_ = function ( gl, writeId ) {
/*
			 buffer testing
			 gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.colorBuffers[writeId]);
			 gl.clearColor(1, 0, 0, 0.5);
			 gl.clear(gl.COLOR_BUFFER_BIT);

			 gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.blendBackBuffer);
			 gl.clearColor(0, 1, 0, 0.5);
			 gl.clear(gl.COLOR_BUFFER_BIT);
*/
			let offsetBack = writeId * 3;
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

			gl.useProgram(this.dpFinPrgData.program);
			gl.uniform1i(this.dpFinPrgData.uColorBuffer, offsetBack + 1);
			gl.uniform1i(this.dpFinPrgData.uBackColorBuffer, 6);

			this.drawQuads_(gl);

		};

		this.drawQuads_ = function ( gl ) {

			gl.bindBuffer( gl.ARRAY_BUFFER, this.quadBuffer );
			gl.vertexAttribPointer( 0, 2, gl.FLOAT, false, 0, 0 );

			gl.drawArrays( gl.TRIANGLES, 0, 6 );

		};

		this.getNumDepthPeelingPasses = function () {
			return this.numDepthPeelingPasses;
		};

		this.isDepthPeelingOn = function () {
			return this.depthPeelingRender && this.numDepthPeelingPasses;
		};

		this.dispose = function ( ) {

			console.warn('WebGLDepthPeeling.dispose is not tested yet.');

			if (this.blendBackBuffer) {
				gl.deleteFramebuffer(this.blendBackBuffer)
				this.blendBackBuffer = null;
			}

			if (this.depthTarget) {
				gl.deleteTexture(this.depthTarget[0]);
				gl.deleteTexture(this.depthTarget[1]);
				this.depthTarget = null;
			}

			if (this.frontColorTarget) {
				gl.deleteTexture(this.frontColorTarget[0]);
				gl.deleteTexture(this.frontColorTarget[1]);
				this.frontColorTarget = null;
			}

			if (this.backColorTarget) {
				gl.deleteTexture(this.backColorTarget[0]);
				gl.deleteTexture(this.backColorTarget[1]);
				this.backColorTarget = null;
			}

			if (this.blendBackTarget) {
				gl.deleteTexture(this.blendBackTarget);
				this.blendBackTarget = null;
			}
		}
	};
}

export { WebGLDepthPeeling };
