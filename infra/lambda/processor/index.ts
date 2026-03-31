export const handler = async (event: any) => {
  console.log('Processor handler invoked', JSON.stringify(event));
  return { statusCode: 200, body: 'Processor stub' };
};
