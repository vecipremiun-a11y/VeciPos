// Test que la API ya no consume folios sin force=true
const r = await fetch('http://localhost:3010/api/sii/reserve-folios', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-company-id': 'default' },
  body: JSON.stringify({ tipo_dte: 39, count: 50 }),
});
console.log('Status:', r.status);
console.log('Body:', await r.json());
