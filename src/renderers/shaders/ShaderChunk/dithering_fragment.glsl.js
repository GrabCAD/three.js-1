export default /* glsl */`
#if defined( DITHERING )

	three_FragColor.rgb = dithering( three_FragColor.rgb );

#endif
`;
