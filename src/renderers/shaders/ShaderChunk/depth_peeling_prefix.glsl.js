export default /* glsl */`
#ifdef DEPTH_PEELING

#define MAX_DEPTH 99999.0

uniform sampler2D depthBufferIn;
uniform sampler2D frontColorIn;

// RG32F, R - negative front depth, G - back depth
layout(location=0) out vec2 depth;
layout(location=1) out vec4 outFrontColor;
layout(location=2) out vec4 outBackColor;

vec3 clamp3(vec3 val, float min, float max) {
	return vec3(
		clamp(val.r, min, max ),
		clamp(val.g, min, max ), 
		clamp(val.b, min, max )
	);
}

vec4 clamp4(vec4 val, float min, float max) {
	return vec4(
		clamp(val.r, min, max ),
		clamp(val.g, min, max ), 
		clamp(val.b, min, max ), 
		clamp(val.a, min, max )
	);
}

#endif
`;
