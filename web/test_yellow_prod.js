const WebSocket = require('ws');
const ws = new WebSocket('wss://clearnet.yellow.com/ws');
ws.on('open', () => {
    ws.send(JSON.stringify({ req: [1, 'get_config', {}, Date.now()], sig: [] }));
});
ws.on('message', (data) => {
    const res = JSON.parse(data);
    if(res.res && res.res[1] === 'get_config') {
        const conf = res.res[2];
        console.log(JSON.stringify(conf, null, 2));
        process.exit(0);
    }
});
ws.on('error', (e) => {
    console.log("Error connecting to prod:", e.message);
    process.exit(1);
})
