CREATE MODEL `watsonx_granite_model`
INPUT (prompt STRING)
OUTPUT (generated_text STRING)
WITH (
  'provider' = 'watsonx',
  'task' = 'text_generation',
  'watsonx.endpoint' = 'https://eu-de.ml.cloud.ibm.com',
  'watsonx.api_key' = '<YOUR_WATSONX_API_KEY>',
  'watsonx.model_id' = 'ibm/granite-13b-instruct-v2'
);
