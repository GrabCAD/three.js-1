export default /* glsl */`

#ifdef DEPTH_PEELING

// dual depth peeling
// write to back and front color buffer                            
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