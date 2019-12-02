export default /* glsl */`

#ifdef DEPTH_PEELING

float fragDepth = gl_FragCoord.z;   // 0 - 1

ivec2 fragCoord = ivec2(gl_FragCoord.xy);
vec2 lastDepth = texelFetch(depthBufferIn, fragCoord, 0).rg;
outFrontColor = texelFetch(frontColorIn, fragCoord, 0);

outBackColor = vec4(0.0);

// write out next peel. -MAX_DEPTH is effectively a NO OP
depth.rg = vec2(-MAX_DEPTH);


// The '-' on near makes a max blend behave like a negative blend
// both depths are converging toward each other

// Testing confirms that nearestDepth = 0 and furthestDepth = 1
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

#endif

`
