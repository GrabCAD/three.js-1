export default /* glsl */`
#ifdef DEPTH_PEELING

#define MAX_DEPTH 99999.0
#define DP_FACE_STATUS_NONE 0.0
#define DP_FACE_STATUS_BACK -0.1
#define DP_FACE_STATUS_FRONT -0.2

uniform sampler2D depthBufferIn;
uniform sampler2D frontColorIn;

// RG32F, R - negative front depth, G - back depth
layout(location=0) out vec4 depth;
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

bool depthLess( float depth0, float faceDist0,
								float depth1, float faceDist1) {
	if (depth0 < depth1)
		return true;
	else if (depth0 > depth1)
		return false;
		
	return faceDist0 < faceDist1;
}

bool depthGreater( float depth0, float faceDist0,
								   float depth1, float faceDist1) {
	if (depth0 > depth1)
		return true;
	else if (depth0 < depth1)
		return false;
		
	return faceDist0 > faceDist1;
}

bool depthEqual( float depth0, float faceDist0,
								 float depth1, float faceDist1) {
	return (depth0 == depth1) && (faceDist0 == faceDist1);
}

#endif
`;
