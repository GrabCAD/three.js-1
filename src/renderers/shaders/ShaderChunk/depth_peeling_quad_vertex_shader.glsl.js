export default /* glsl */ `#version 300 es
in vec4 inPosition;
void main() {
	gl_Position = inPosition;
}
`;
