import fetch from 'node-fetch';

// Configuration - Set your values here
const CONFIG = {
    txHash: '0x80bb655a8ef1b3cdb24636f8506096cc23631b0116861e71671a5ba6fd94fef3', //axelar tx example 0x3fbb62833fefe6b3fe53d463b2777d1569ff234d5752b2ee6bd39abed8281d62
    integratorId: 'YOUR_INTEGRATOR_ID',
    fromChainId: '56',     // Optional - set to null or remove if not needed
    toChainId: '42161'     // Optional - set to null or remove if not needed
};

// API endpoints
const AXELAR_API = 'https://api.axelarscan.io/gmp/searchGMP'; //Axelarscan API documentation:https://docs.axelarscan.io/gmp#searchGMP
const SQUID_API = 'https://v2.api.squidrouter.com/v2/rfq/order';

async function lookupTransaction() {
    try {
        // Validate txHash
        if (!CONFIG.txHash.startsWith('0x')) {
            throw new Error('Transaction hash must start with 0x');
        }

        // Validate integratorId
        if (!CONFIG.integratorId || CONFIG.integratorId === 'YOUR_INTEGRATOR_ID') {
            throw new Error('Please set your integrator ID in the CONFIG object');
        }

        // Build Axelar request body
        const axelarBody = {
            size: 1,
            txHash: CONFIG.txHash
        };

        // Add optional chain IDs if they exist
        if (CONFIG.fromChainId) axelarBody.fromChainId = CONFIG.fromChainId;
        if (CONFIG.toChainId) axelarBody.toChainId = CONFIG.toChainId;

        console.log('Checking Axelar API...');
        const axelarResponse = await fetch(AXELAR_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(axelarBody)
        });

        if (!axelarResponse.ok) {
            throw new Error(`Axelar API error: ${axelarResponse.status}`);
        }

        const axelarData = await axelarResponse.json();

        // If Axelar found the transaction, return it
        if (axelarData.data && axelarData.data.length > 0) {
            console.log('Transaction found in Axelar:');
            console.log(JSON.stringify(axelarData, null, 2));
            return;
        }

        console.log('No transaction found in Axelar, trying Squid API...');

        // Try Squid API as fallback
        const squidResponse = await fetch(SQUID_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-integrator-id': CONFIG.integratorId
            },
            body: JSON.stringify({
                hash: CONFIG.txHash
            })
        });

        if (!squidResponse.ok) {
            throw new Error(`Squid API error: ${squidResponse.status}`);
        }

        const squidData = await squidResponse.json();
        console.log('Transaction found in Squid:');
        console.log(JSON.stringify(squidData, null, 2));

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run the lookup
lookupTransaction();