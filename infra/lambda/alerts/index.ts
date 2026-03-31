export const handler = async (event: any) => {
  console.log('Alerts handler invoked', JSON.stringify(event));
  return { statusCode: 200, body: 'Alerts stub' };
};
