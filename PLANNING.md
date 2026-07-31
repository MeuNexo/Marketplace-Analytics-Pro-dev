# Onde mora o planejamento

O planejamento deste repositório **não vive mais aqui**. Ele está em:

    /root/nexo-os

**Por quê:** o `garment`, o `nexo-mcp` e o `/root/nexo` viraram um sistema só —
este repo é a **fonte única dos números** (DRE, caixa, margem, tesouraria) e o
dashboard; o `nexo-mcp` é o braço de ação em ML/Tiny e alcança estes números por
delegação. Dois `.planning/` paralelos não representavam isso: uma fase do MCP
chegou a precisar de migration aqui, e outra travou dependendo de trabalho que
morava em dois outros repos, sem nada registrar a dependência.

**Todo comando `/gsd-*` roda de `/root/nexo-os`.** As fases de lá declaram no
cabeçalho quais repos tocam — este aparece como `garment`.

**O histórico deste repo** está preservado inteiro em
`/root/nexo-os/.planning/archive/garment/` — 435 arquivos, milestones v1 a v8.0,
fases 1 a 106. A numeração do sistema recomeça em 200; qualquer número abaixo
disso é história e identifica de qual repo veio.

---

**Se você digitou `/gsd-progress` aqui e ele não achou projeto:** é isto. Não
inicialize um projeto novo — vá para o `nexo-os`.

**Se está retomando um PR antigo** que mexe em `.planning/`: vai dar conflito
modify/delete. Aceite a remoção e descarte o hunk.
