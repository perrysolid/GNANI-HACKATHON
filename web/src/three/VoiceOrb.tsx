import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Float, Lightformer, MeshDistortMaterial, RoundedBox } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import type { Group, Mesh } from 'three'

function Lights() {
  return (
    <Environment resolution={128}>
      <Lightformer intensity={2.4} position={[0, 4, 3]} scale={[8, 3, 1]} />
      <Lightformer intensity={1.2} position={[-4, 0, 2]} scale={[2, 6, 1]} color="#ffd9c4" />
      <Lightformer intensity={0.9} position={[4, -2, 1]} scale={[3, 3, 1]} color="#c9e6ff" />
    </Environment>
  )
}

/** A rounded 3D speech bubble with a tail. */
function Bubble({ color, flip, position, scale = 1, phase = 0 }: { color: string; flip?: boolean; position: [number, number, number]; scale?: number; phase?: number }) {
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const t = clock.getElapsedTime() + phase
    g.rotation.y = Math.sin(t * 0.6) * 0.25 + (flip ? 0.35 : -0.35)
    g.rotation.x = Math.sin(t * 0.4) * 0.08
  })
  const s = flip ? -1 : 1
  return (
    <group ref={group} position={position} scale={scale}>
      <RoundedBox args={[1.9, 1.25, 0.55]} radius={0.27} smoothness={8}>
        <meshPhysicalMaterial color={color} roughness={0.18} metalness={0.05} clearcoat={1} clearcoatRoughness={0.15} />
      </RoundedBox>
      <mesh position={[0.55 * s, -0.72, 0]} rotation={[0, 0, s * 0.55]}>
        <coneGeometry args={[0.22, 0.48, 32]} />
        <meshPhysicalMaterial color={color} roughness={0.18} clearcoat={1} clearcoatRoughness={0.15} />
      </mesh>
      {/* three dots: "typing / speaking" */}
      {[-0.42, 0, 0.42].map((x, i) => (
        <Dot key={i} x={x} i={i} light={color === '#1A1A1A'} />
      ))}
    </group>
  )
}

function Dot({ x, i, light }: { x: number; i: number; light: boolean }) {
  const m = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    if (m.current) m.current.position.y = Math.max(0, Math.sin(clock.getElapsedTime() * 4 - i * 0.7)) * 0.12
  })
  return (
    <mesh ref={m} position={[x, 0, 0.29]}>
      <sphereGeometry args={[0.11, 32, 32]} />
      <meshStandardMaterial color={light ? '#FFFFFF' : '#111111'} roughness={0.3} />
    </mesh>
  )
}

/** A 3D voice waveform: capsules whose heights move like speech. */
function Wave({ count = 15, width = 3.6, y = -1.55 }: { count?: number; width?: number; y?: number }) {
  const bars = useRef<(Mesh | null)[]>([])
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => 0.6 + ((i * 37) % 11) / 11), [count])
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    bars.current.forEach((b, i) => {
      if (!b) return
      const centre = 1 - Math.abs(i - (count - 1) / 2) / ((count - 1) / 2)
      const h = 0.25 + (0.35 + centre * 0.9) * Math.abs(Math.sin(t * 2.6 * seeds[i] + i * 0.55))
      b.scale.y = h
    })
  })
  return (
    <group position={[0, y, 0.2]}>
      {seeds.map((_, i) => {
        const x = -width / 2 + (i / (count - 1)) * width
        return (
          <mesh key={i} ref={(el) => { bars.current[i] = el }} position={[x, 0, 0]}>
            <capsuleGeometry args={[0.065, 0.7, 8, 16]} />
            <meshPhysicalMaterial color={i % 2 ? '#C8F24A' : '#1A1A1A'} roughness={0.2} clearcoat={1} />
          </mesh>
        )
      })}
    </group>
  )
}

/** Hero: two languages, two bubbles, one voice in between. */
export function HeroScene() {
  return (
    <Canvas camera={{ position: [0, 0.1, 6.4], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={0.6} />
      <Lights />
      <Float speed={1.3} rotationIntensity={0.15} floatIntensity={0.5}>
        <Bubble color="#1A1A1A" position={[-0.95, 0.75, -0.4]} scale={0.95} />
      </Float>
      <Float speed={1.6} rotationIntensity={0.15} floatIntensity={0.6}>
        <Bubble color="#C8F24A" flip position={[0.95, -0.15, 0.3]} phase={1.7} />
      </Float>
      <Wave />
    </Canvas>
  )
}

function Blob({ color, speed, distort, active }: { color: string; speed: number; distort: number; active?: boolean }) {
  const mesh = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    if (!mesh.current) return
    const t = clock.getElapsedTime()
    mesh.current.scale.setScalar(active ? 1 + Math.sin(t * 2.2) * 0.035 : 1)
    mesh.current.rotation.y = t * 0.15
  })
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1, 64]} />
      <MeshDistortMaterial color={color} roughness={0.12} metalness={0.15} distort={distort} speed={speed} />
    </mesh>
  )
}

/** Small status orb for cards and the call screen. */
export function StatusOrb({ color = '#C8F24A', active = true }: { color?: string; active?: boolean }) {
  return (
    <Canvas camera={{ position: [0, 0, 3.4], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.5} />
      <Lights />
      <Float speed={2} rotationIntensity={0.3} floatIntensity={0.4}>
        <Blob color={color} speed={active ? 2.4 : 0.8} distort={active ? 0.38 : 0.18} active={active} />
      </Float>
    </Canvas>
  )
}

export default HeroScene
