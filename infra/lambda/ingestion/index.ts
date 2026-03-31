export const handler = async (event: any) => {
  console.log('Ingestion handler invoked', JSON.stringify(event));
  return { statusCode: 200, body: 'Ingestion stub' };
};
