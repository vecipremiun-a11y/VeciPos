import integrationConfigHandler from '../integration/config.js';

export default async function handler(req, res) {
    return integrationConfigHandler(req, res);
}
