export default /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D frontColorIn;
uniform sampler2D uBackColorBuffer;
uniform int testMode;
#define DEPTH_PEELING 1
`;
