import { useEffect, useRef } from 'react'

interface Agent {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
}

export function AgentSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const agentsRef = useRef<Agent[]>([])
  const animationFrameRef = useRef<number>()

  // Initialize agents
  useEffect(() => {
    const numAgents = 40 // Reduced number of agents
    const agents: Agent[] = []
    
    for (let i = 0; i < numAgents; i++) {
      agents.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * 400,
        vx: (Math.random() - 0.5) * 3, // Faster movement
        vy: (Math.random() - 0.5) * 3,
        size: 3,
        color: 'rgba(239, 68, 68, 0.8)'
      })
    }

    agentsRef.current = agents
  }, [])

  // Animation loop
  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = 400
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const animate = () => {
      if (!ctx) return

      // Clear canvas
      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const agents = agentsRef.current

      // Update and draw agents
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i]

        // Update position
        agent.x += agent.vx
        agent.y += agent.vy

        // Bounce off walls
        if (agent.x < 0 || agent.x > canvas.width) agent.vx *= -1
        if (agent.y < 0 || agent.y > canvas.height) agent.vy *= -1

        // Draw connections
        for (let j = i + 1; j < agents.length; j++) {
          const other = agents[j]
          const dx = other.x - agent.x
          const dy = other.y - agent.y
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance < 150) {
            ctx.beginPath()
            ctx.moveTo(agent.x, agent.y)
            ctx.lineTo(other.x, other.y)
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.15 * (1 - distance / 150)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }

        // Draw agent
        ctx.beginPath()
        ctx.arc(agent.x, agent.y, agent.size, 0, Math.PI * 2)
        ctx.fillStyle = agent.color
        ctx.fill()
      }

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none' }}
    />
  )
} 