export default /* glsl */ `
out vec4 fragColor;

#define MAX_DEPTH 99999.0

#define testFlagDrawColor 0
#define testFlagDrawDepthNear 1
#define testFlagDrawDepthFar 2
#define testFlagDrawDepthNearBack 3
#define testFlagDrawDepthFarBack 4

#define DP_FACE_STATUS_NEAR_BACK 1.0
#define DP_FACE_STATUS_NEAR_FRONT 2.0
#define DP_FACE_STATUS_NONE 3.0
#define DP_FACE_STATUS_FAR_FRONT 4.0
#define DP_FACE_STATUS_FAR_BACK 5.0

void renderNormal() {
	// Blend final, needs gamma correction
	// See more complete description in peeling fragment shader

	ivec2 fragCoord = ivec2(gl_FragCoord.xy);

	vec4 frontColor = texelFetch(frontColorIn, fragCoord, 0);
	vec4 backColor = texelFetch(uBackColorBuffer, fragCoord, 0);

	float alphaMultiplier = 1.0 - lin(frontColor.a);

	vec3 color = nonLin(lin(frontColor.rgb) + alphaMultiplier * lin(backColor.rgb));


	fragColor = vec4(
		color,
		nonLin(lin(frontColor.a) + lin(backColor.a))
	);

}

void renderDepth(int testMode) {

	// Blend final, needs gamma correction
	// See more complete description in peeling fragment shader

	ivec2 fragCoord = ivec2(gl_FragCoord.xy);

	vec4 depthQuad = texelFetch(frontColorIn, fragCoord.xy, 0);

	float depth = 0.0;
	float intensity;
	vec3 channel = vec3(1,1,1);

#define CAL_INTEN(c,r) intensity = 0.5 + (depth - c) / r
	switch (testMode) {
		case testFlagDrawDepthNear:
			depth = 1.0 - depthQuad.x;
			channel = vec3(1,0,0);
			CAL_INTEN(0.68, 0.01); // Determined by sampling the output image
			intensity = 1.0 - intensity;
			break;

		case testFlagDrawDepthFar:
			depth = depthQuad.y;
			channel = vec3(0,1,0);
			CAL_INTEN(0.675, 0.01); // Determined by sampling the output image
			break;

		case testFlagDrawDepthNearBack:
			depth = depthQuad.z;
			CAL_INTEN(0.5, 1.0);
			break;

		case testFlagDrawDepthFarBack:
			depth = depthQuad.w;
			CAL_INTEN(0.5, 1.0);
			break;
	}

//	intensity = clamp(depth, 0.0, 1.0);

	fragColor = vec4(channel * intensity, 1);

}

void renderColorBuffer(int testMode) {
	// Blend final, needs gamma correction
	// See more complete description in peeling fragment shader

	ivec2 fragCoord = ivec2(gl_FragCoord.xy);

	fragColor = texelFetch(frontColorIn, fragCoord, 0);
}

void main() {
	switch (testMode) {
		default:
			renderNormal(); 
			break;
		
		case testFlagDrawDepthNear:
		case testFlagDrawDepthFar:
		case testFlagDrawDepthNearBack:
		case testFlagDrawDepthFarBack:
		
			renderDepth(testMode);
			break;
			
		case testFlagDrawColor:
		  renderColorBuffer(testMode);
			break;
	}
}
`;
