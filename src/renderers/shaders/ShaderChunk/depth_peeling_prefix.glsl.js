export default /* glsl */`
#ifdef DEPTH_PEELING

#define MAX_DEPTH 99999.0
precision highp float;
precision highp sampler2D;

uniform sampler2D uDepthBuffer;
uniform sampler2D uColorBuffer;

layout(location=1) out vec2 depth;  // RG32F, R - negative front depth, G - back depth
layout(location=2) out vec4 outFrontColor;
layout(location=3) out vec4 outBackColor;


#endif

`;
