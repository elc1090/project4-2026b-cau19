// Confere se a IA (Gemini) está funcionando, sem precisar abrir o site.
// Uso:  npm run test:ia
// Faz um pedido pequeno com resposta em JSON. Se der erro, o motivo aparece no terminal.
require('dotenv').config();
const ai = require('../ai');

async function main() {
  console.log('Testando a IA (o app tenta vários modelos gratuitos, na ordem da lista MODELS do ai.js)...');
  const text = await ai.callGemini({
    systemInstruction: 'Responda em português, em JSON.',
    input: 'Cumprimente o estudante e diga quanto é 2 + 2.',
    schema: {
      type: 'object',
      properties: { saudacao: { type: 'string' }, resultado: { type: 'number' } },
      required: ['saudacao', 'resultado'],
    },
  });
  console.log('Resposta da IA:', text);
  console.log('OK: a IA está funcionando.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Falhou:', error.message);
  process.exit(1);
});
