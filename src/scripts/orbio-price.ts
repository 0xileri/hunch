// Prices ORBIO from recent trades on chain. Read-only: no key, no spend.
import '../env.js'
import { readOrbioUsd } from '../chain/rate.js'

const price = await readOrbioUsd()
if (!price) console.log('Not enough trades carried both ORBIO and USDG to price it.')
else console.log(`ORBIO $${price.usd.toFixed(5)} from ${price.samples} trades · read ${price.at}`)
