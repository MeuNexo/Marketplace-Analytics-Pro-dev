-- Motivo legível da reclamação (traduzido do reason_id via ML). motivo guarda o
-- código (PDD/PNR); motivo_texto guarda o texto para exibir na tabela sem abrir a
-- reclamação. Populado daqui pra frente pelo sync-ml-claims (resolve reason_id→detail).
ALTER TABLE public.ml_claims ADD COLUMN IF NOT EXISTS motivo_texto text;

-- Backfill dos códigos em uso (dicionário ML de motivos) no momento da migração.
UPDATE public.ml_claims SET motivo_texto = CASE motivo
  WHEN 'PDD9939' THEN 'A minha compra chegou em boas condições, mas eu não a quero mais'
  WHEN 'PDD9946' THEN 'Chegou bem'
  WHEN 'PDD9952' THEN 'Chegou bem'
  WHEN 'PDD9958' THEN 'Chegou bem'
  WHEN 'PDD9963' THEN 'Não é da cor, tamanho ou modelo que escolhi'
  WHEN 'PDD9965' THEN 'Chegou bem'
  WHEN 'PDD9976' THEN 'É maior do que eu imaginava'
  WHEN 'PDD9977' THEN 'É menor do que eu imaginava'
  WHEN 'PDD9978' THEN 'Não quero por outros motivos'
  WHEN 'PNR9511' THEN 'Não posso receber a compra no endereço informado'
  WHEN 'PNR9513' THEN 'Outro motivo'
  ELSE motivo_texto
END
WHERE motivo IS NOT NULL;
