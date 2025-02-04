const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

// Valid NODE_ENV values
const validNodeEnvs = ['development', 'production', 'test'] as const

export function checkEnvironmentVariables() {
  // Check required env vars
  const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar]
  )

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvVars.join(', ')}`
    )
  }

  // Check NODE_ENV
  const nodeEnv = process.env.NODE_ENV
  if (nodeEnv && !validNodeEnvs.includes(nodeEnv as any)) {
    throw new Error(
      `Invalid NODE_ENV value: ${nodeEnv}. Must be one of: ${validNodeEnvs.join(', ')}`
    )
  }

  // Warn if NODE_ENV is not set
  if (!nodeEnv) {
    console.warn(
      'NODE_ENV is not set. Defaulting to "development". ' +
      'While this will work, it\'s recommended to explicitly set NODE_ENV.'
    )
  }
}

