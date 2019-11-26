import depthPeelingPrefixChunk from './shaders/ShaderChunk/depth_peeling_prefix.glsl.js';
import gammaFuncs from './shaders/ShaderChunk/depth_peeling_gamma_functions.glsl.js';
import depthPeelingMainPrefixChunk from './shaders/ShaderChunk/depth_peeling_main_prefix.glsl.js';
import depthPeelingMainSuffixChunk from './shaders/ShaderChunk/depth_peeling_main_suffix.glsl.js';

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
				gammaFuncs,
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

			// console.log( '*VERTEX*', vertexGlsl );
			// console.log( '*FRAGMENT*', fragmentGlsl );
			var debugShader = false && depthPeelingEnabled;
			if( debugShader ) {
				fragmentGlsl =
					`#version 300 es
            precision highp float;
            precision highp sampler2D;
            #define MAX_DEPTH 99999.0
            uniform sampler2D uDepthBuffer;
            uniform sampler2D uColorBuffer;
            
            layout(location=0) out vec2 depth;  // RG32F, R - negative front depth, G - back depth
            layout(location=1) out vec4 outFrontColor;
            layout(location=2) out vec4 outBackColor;

#define DEPTH_PEELING 1
` + gammaFuncs + `\n			

            void main() {

                float fragDepth = gl_FragCoord.z;   // 0 - 1
        
                ivec2 fragCoord = ivec2(gl_FragCoord.xy);
                vec2 lastDepth = texelFetch(uDepthBuffer, fragCoord, 0).rg;
                vec4 lastFrontColor = texelFetch(uColorBuffer, fragCoord, 0);

                // write out next peel. -MAX_DEPTH is effectively a NO OP
                depth.rg = vec2(-MAX_DEPTH);

                outFrontColor = lastFrontColor;
                outBackColor = vec4(0.0);

                // The '-' on near makes a max blend behave like a negative blend
                // both depths are converging toward each other                    
                float nearestDepth = -lastDepth.x;
                float furthestDepth = lastDepth.y;

                if (fragDepth < nearestDepth || fragDepth > furthestDepth) {
                    // Skip this depth since it's been peeled.
                    return;
                }

                if (fragDepth > nearestDepth && fragDepth < furthestDepth) {
                    // This needs to be peeled.
                    // The ones remaining after MAX blended for 
                    // all need-to-peel will be peeled next pass.
                    depth.rg = vec2(-fragDepth, fragDepth);
                    return;
                }

                // -------------------------------------------------------------------
                // If it reaches here, it is the layer we need to render for this pass
                // -------------------------------------------------------------------

// If green, increase thresh
// If red, decrease thresh
float thresh = 0.5;
float step = 0.25;

thresh += step;
step /= 2.0;

thresh -= step;
step /= 2.0;

thresh += step;
step /= 2.0;

thresh -= step;
step /= 2.0;

thresh += step;
step /= 2.0;

thresh += step;
step /= 2.0;

fragDepth = (fragDepth - thresh) * 1000.0 + thresh;
vec4 resultColor;
								if (fragDepth < thresh)
	                resultColor = vec4(fragDepth,0,0,0.5);
	              else
	                resultColor = vec4(0,fragDepth,0,0.5);

                // dual depth peeling
                // write to back and front color buffer                            
                if (fragDepth == nearestDepth) {
                    vec4 farColor = resultColor;
                    vec4 nearColor = outFrontColor;
                    float nearLinAlpha = lin(nearColor.a); 
                    float farLinAlpha = lin(farColor.a); 

                    float alphaMultiplier = 1.0 - nearLinAlpha;

                    outFrontColor.rgb = nonLin(lin(farColor.rgb) * farLinAlpha * alphaMultiplier +
                        lin(nearColor.rgb) * farLinAlpha);
                    outFrontColor.a = nonLin(farLinAlpha * farLinAlpha * alphaMultiplier + nearLinAlpha);
                } else {
                    outBackColor = resultColor;
                }
            }
        `;
			}

			return fragmentGlsl;
		};

		this.prepareDbBuffers_ = function ( camera ) {

			var gl = this.renderer.context;

			this.initBuffers_( gl );
			this.resizeBuffers_( gl.drawingBufferWidth, gl.drawingBufferHeight );

			gl.enable( gl.BLEND );
			gl.disable( gl.DEPTH_TEST );
			gl.enable( gl.CULL_FACE );
		};

		this.initBuffers_ = function ( gl ) {

			if ( this.initialized ) return;

			gl.getExtension( "EXT_color_buffer_float" );

			this.setupShaders_( gl );
			this.initDpBuffers_( gl );
			this.setupQuad_( gl );
			this.initialized = true;

		};

		this.setupShaders_ = function ( gl ) {

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

#define DEPTH_PEELING 1
` + gammaFuncs + `\n			
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

			this.blBackPrgData = new ProgramData();
			this.finPrgData = new ProgramData();

			this.blBackPrgData.program = createProgram( fullScreenQuadVertexShader, blendBackFragmentShader, "blBackPrgData" );
			this.blBackPrgData.uBackColorBuffer = gl.getUniformLocation( this.blBackPrgData.program, "uBackColorBuffer" );

			this.finPrgData.program = createProgram( fullScreenQuadVertexShader, finalFragmentShader, "finPrgData" );
			this.finPrgData.uColorBuffer = gl.getUniformLocation( this.finPrgData.program, "uColorBuffer" );
			this.finPrgData.uBackColorBuffer = gl.getUniformLocation( this.finPrgData.program, "uBackColorBuffer" );

		};

		this.initDpBuffers_ = function ( gl ) {

			this.depthBuffers = [gl.createFramebuffer(), gl.createFramebuffer()];

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

		this.resizeBuffers_ = function ( width, height ) {
			if ( !this.initialized ) return;

			if (this.bufferSize &&
				this.bufferSize.width === width &&
				this.bufferSize.height === height) {
				// already resized
				return;
			}

			var arbitraryMinBufferSize = 4;
			if (!width || !height ||
				(width < arbitraryMinBufferSize && height < arbitraryMinBufferSize)) {
				// Test for an arbitrarily small buffer
				console.warn('WebGLDepthPeeling.resizeBuffers_ called with bad sizes');
				return;
			}

			this.bufferSize = {
				width: width,
				height: height
			};

			var gl = this.renderer.context;

			for ( var i = 0; i < 2; i ++ ) {

				var o = i * 3;

				gl.bindFramebuffer( gl.FRAMEBUFFER, this.depthBuffers[ i ] );

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
					width,
					height,
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
					width,
					height,
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
					width,
					height,
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
				width,
				height,
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

			gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.depthBuffers[ writeId ] );
			gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
			gl.clearColor( DEPTH_CLEAR_VALUE, DEPTH_CLEAR_VALUE, 0, 0 );
			gl.clear( gl.COLOR_BUFFER_BIT );

			gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.colorBuffers[ writeId ] );
			gl.drawBuffers( [ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT0 + 1 ] );
			gl.clearColor( 0, 0, 0, 0 );
			gl.clear( gl.COLOR_BUFFER_BIT );

			gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.blendBackBuffer );
			gl.clearColor( 0, 0, 0, 0 );
			gl.clear( gl.COLOR_BUFFER_BIT );

			if ( init ) {

				gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.depthBuffers[ readId ] );
				gl.clearColor( - MIN_DEPTH_, MAX_DEPTH_, 0, 0 );
				gl.clear( gl.COLOR_BUFFER_BIT );

				gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.colorBuffers[ readId ] );
				gl.clearColor( 0, 0, 0, 0 );
				gl.clear( gl.COLOR_BUFFER_BIT );

			}

		};

		this.initializeBuffersForPass = function ( gl ) {

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

		this.bindBuffersForDraw_ = function ( program ) {

			if (this.isDepthPeelingOn()) {
				var gl = this.renderer.context;

				var offsetRead = 3 * this.readId;

				// Buffer bindings seem wrong, nothing is written to the backColorTexture

				gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, this.depthBuffers[ this.writeId ] );
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
			// buffer testing
			gl.clearColor(1, 0, 0, 0.5);
			gl.clear(gl.COLOR_BUFFER_BIT);
*/

			gl.useProgram( this.blBackPrgData.program );
			var backColorLoc = gl.getUniformLocation( this.blBackPrgData.program, "uBackColorBuffer" );
			gl.uniform1i( backColorLoc, offsetBack + 2 );

			this.drawQuads_( gl );

		};

		this.blendFinal_ = function ( gl, writeId ) {
/*
			 // buffer testing
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

			gl.useProgram(this.finPrgData.program);

			var uColorBufferLoc = gl.getUniformLocation( this.finPrgData.program, "uColorBuffer" );
			var uBackColorBuffer = gl.getUniformLocation( this.finPrgData.program, "uBackColorBuffer" );

			gl.uniform1i(uColorBufferLoc, offsetBack + 1);
			gl.uniform1i(uBackColorBuffer, 6);

			this.drawQuads_(gl);

		};

		this.drawQuads_ = function ( gl ) {

			gl.bindBuffer( gl.ARRAY_BUFFER, this.quadBuffer );
			gl.vertexAttribPointer( 0, 2, gl.FLOAT, false, 0, 0 );

			gl.drawArrays( gl.TRIANGLES, 0, 6 );

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
