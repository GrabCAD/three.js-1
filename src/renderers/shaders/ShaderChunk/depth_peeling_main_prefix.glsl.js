export default /* glsl */`

#ifdef DEPTH_PEELING

float fragDepth = gl_FragCoord.z;   // 0 - 1

ivec2 fragCoord = ivec2(gl_FragCoord.xy);
vec4 lastDepth = texelFetch(depthBufferIn, fragCoord, 0);
outFrontColor = texelFetch(frontColorIn, fragCoord, 0);

outBackColor = vec4(0.0);

// write out next peel. -MAX_DEPTH is effectively a NO OP
depth = vec4( -MAX_DEPTH );

// The '-' on near makes a max blend behave like a negative blend
// both depths are converging toward each other

// using nearestDepth as a negative number into a color buffer is an
// undefined behavior. Our implementation has difficulty with this.
// The algorithm was modified to use 1 - depth which keeps all values in the 0-1 range
// while still negating the value so that a max filter behaves as a min filter.
float nearestDepth       = 1.0 - lastDepth.x;
float furthestDepth      = lastDepth.y;
float nearestFaceStatus  = 1.0 - lastDepth.z;
float furthestFaceStatus = lastDepth.w;

float fragFaceStatus = DP_FACE_STATUS_NONE;

//if (fragDepth < nearestDepth || fragDepth > furthestDepth) {
if (depthLess(fragDepth, fragFaceStatus, nearestDepth, nearestFaceStatus) || 
    depthGreater(fragDepth, fragFaceStatus, furthestDepth, furthestFaceStatus)) {
		// Skip this depth since it's been peeled.

		return;
}

//if (fragDepth > nearestDepth && fragDepth < furthestDepth) {
if (depthGreater(fragDepth, fragFaceStatus, nearestDepth, nearestFaceStatus) && 
		depthLess(fragDepth, fragFaceStatus, furthestDepth, furthestFaceStatus)) {

		// This hasn't been peeled so it's put throught the min/max filter to decide which is the
		// next min/max. The single fragment depth value is written to both the min and max depth buffers.
		// The min (near) buffer is implemented as a maximum of negative valus, so it is written as a negative value.
		depth = vec4(1.0 - fragDepth, fragDepth, 1.0 - fragFaceStatus, fragFaceStatus);

		return;
}

// -------------------------------------------------------------------
// If it reaches here, it is the layer we need to render for this pass
// -------------------------------------------------------------------

#endif

`
