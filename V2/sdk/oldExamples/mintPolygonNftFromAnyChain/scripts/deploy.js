async function main() {
	const verify = async (contractAddress, args) => {
		console.log('Verifying contract...');
		try {
			await run('verify:verify', {
				address: contractAddress,
				constructorArguments: args,
			});
		} catch (e) {
			if (e.message.toLowerCase().includes('already verified')) {
				console.log('Already verified!');
			} else {
				console.log(e);
			}
		}
	};

	const SquidEasterEggNft = await ethers.getContractFactory('squidEasterEggNft');

	const name = 'Squid Easter Egg';
	const symbol = 'SQUIDEGG';
	const baseTokenURI = 'egg';

	const squidEasterEggNft = await SquidEasterEggNft.deploy(name, symbol, baseTokenURI);
	await squidEasterEggNft.deployed();
	console.log('SquidEasterEggNft deployed to:', squidEasterEggNft.address);

	console.log('Waiting for blocks confirmations...');
	await squidEasterEggNft.deployTransaction.wait(6);
	console.log('Confirmed!');

	const squidEasterEggNftArgs = [name, symbol, baseTokenURI];
	await verify(squidEasterEggNft.address, squidEasterEggNftArgs);

	console.log('SquidEasterEggNft deployed to:', squidEasterEggNft.address);
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
