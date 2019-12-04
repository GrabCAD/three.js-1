export default /* glsl */`
#ifdef DEPTH_PEELING

// We are doing our own blending between different depth layers.
// For most graphics purposes, depth peeling can ignore this, for HQ color we should not.
//
// From literature, the video card does automatic gamma correction during blending, 
// but we're not using the card. So, we do our own gamma correction. See 
// https://blog.johnnovak.net/2016/09/21/what-every-coder-should-know-about-gamma/

#if 1
// This definitely seems the correct approach, the other option is retained for future comparison if anyone
// else wants to test it.
// gamma corrected
	float lin(float inVal)
	{
		float gamma = 2.2;
		return pow(abs(inVal), gamma);
	}
	
	vec3 lin(vec3 inVal)
	{
		return vec3(lin(inVal.r), lin(inVal.g), lin(inVal.b));
	}

	float nonLin(float inVal)
	{
		float gammaInv = 1.0 / 2.2;
		return pow(abs(inVal), gammaInv);
	}

	vec3 nonLin(vec3 inVal)
	{
		return vec3(
			nonLin(inVal.r), 
			nonLin(inVal.g), 
			nonLin(inVal.b)
		);
	}
#else
	// Non gamma corrected, for comparison
#define lin(inVal) inVal
#define nonLin(inVal) inVal
#endif

#endif

`;
