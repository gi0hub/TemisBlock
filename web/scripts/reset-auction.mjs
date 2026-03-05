// Script temporal para borrar los datos de una subasta en Upstash Redis
// Uso: node scripts/reset-auction.mjs [auctionId]
// Ejemplo: node scripts/reset-auction.mjs 0

import { Redis } from '@upstash/redis'
import { readFileSync } from 'node:fs'

// Leer .env.local manualmente
const envFile = readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
    envFile.split('\n')
        .filter(line => line.includes('='))
        .map(line => line.split('=').map(p => p.trim()))
)

const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
})

const auctionId = process.argv[2] ?? '0'
const bidKey = `bids:${auctionId}`
const endKey = `endTime:${auctionId}`

console.log(`🗑️  Borrando datos de auctionId=${auctionId}...`)
await redis.del(bidKey)
await redis.del(endKey)
console.log(`✅ Claves "${bidKey}" y "${endKey}" eliminadas.`)
console.log('   El contador de pujas y el temporizador han sido reiniciados a 0.')
process.exit(0)
