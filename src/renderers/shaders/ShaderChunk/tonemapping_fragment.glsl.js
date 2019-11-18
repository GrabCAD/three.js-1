export default /* glsl */`
#if defined( TONE_MAPPING )

	three_FragColor.rgb = toneMapping( three_FragColor.rgb );

#endif
`;
