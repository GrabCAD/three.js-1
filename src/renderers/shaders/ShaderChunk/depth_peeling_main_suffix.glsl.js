export default /* glsl */`

#ifdef DEPTH_PEELING

// dual depth peeling
// write to back and front color buffer

three_FragColor = clamp4( three_FragColor, 0.0, 1.0 );

bool valid = (
	(0.0 <= three_FragColor.r && three_FragColor.r <= 1.0) &&
	(0.0 <= three_FragColor.g && three_FragColor.g <= 1.0) &&
	(0.0 <= three_FragColor.b && three_FragColor.b <= 1.0) &&
	(0.0 <= three_FragColor.a && three_FragColor.a <= 1.0)
	);
if (!valid )
	three_FragColor = vec4(1,0,0,1);

if (fragDepth == nearestDepth) {
	vec4 farColor = three_FragColor;
	vec4 nearColor = outFrontColor;
	float nearLinAlpha = lin(nearColor.a); 
	float farLinAlpha = lin(farColor.a); 

	float alphaMultiplier = 1.0 - nearLinAlpha;

	outFrontColor.rgb = nonLin(lin(farColor.rgb) * farLinAlpha * alphaMultiplier +
		lin(nearColor.rgb) * farLinAlpha);
	outFrontColor.a = nonLin(farLinAlpha * farLinAlpha * alphaMultiplier + nearLinAlpha);
} else {
	outBackColor = three_FragColor;
}

#else

gl_FragColor = three_FragColor;	

#endif

`
