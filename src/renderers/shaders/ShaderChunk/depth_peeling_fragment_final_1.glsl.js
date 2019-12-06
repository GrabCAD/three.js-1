export default /* glsl */ `
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
		float nearestDepth = -depth.x;
		float furthestDepth = depth.y;

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

		float r = clamp((furthestDepth - thresh) * -10.0 + 0.5, 0.0, 1.0);
		float g = clamp((nearestDepth  - thresh) * -10.0 + 0.5, 0.0, 1.0);

		fragColor = vec4(r, g, 0, 1);
		
	} else {

		fragColor = texelFetch(frontColorIn, fragCoord, 0);

	}
}
`;
