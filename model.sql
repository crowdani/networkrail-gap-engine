CREATE MODEL `watsonx_granite_model`
INPUT (prompt STRING)
OUTPUT (generated_text STRING)
WITH (
  'provider' = 'watsonx',
  'task' = 'text_generation',
  'watsonx.endpoint' = 'https://eu-de.ml.cloud.ibm.com"',
  'watsonx.api_key' = 'HAcyPz8b7WHHlvBiNASlICGmQTaPo7pu-HcwNI1syVe2',
  'watsonx.model_id' = 'ibm/granite-13b-instruct-v2'
);