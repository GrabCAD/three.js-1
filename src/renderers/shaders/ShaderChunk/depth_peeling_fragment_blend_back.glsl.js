export default /* glsl */`#version 300 es
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
