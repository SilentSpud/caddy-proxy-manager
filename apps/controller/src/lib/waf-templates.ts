/**
 * The WAF forms' quick templates. Each must pass filterCustomDirectives untouched, or clicking it
 * inserts a rule the save then refuses; tests/unit/waf-templates.test.ts holds them to that. Ids
 * differ so that inserting several at once does not collide.
 */
export const WAF_QUICK_TEMPLATES = [
  {
    id: "allowIp",
    snippet: `SecRule REMOTE_ADDR "@ipMatch 1.2.3.4" "id:9000,phase:1,allow,nolog,msg:'Allow IP'"`,
  },
  {
    // ctl:ruleEngine is refused, so a path is narrowed rule by rule rather than switched off.
    id: "skipRuleForPath",
    snippet: `SecRule REQUEST_URI "@beginsWith /api/" "id:9001,phase:1,pass,nolog,ctl:ruleRemoveById=942100"`,
  },
  {
    id: "skipXssRulesForPath",
    snippet: `SecRule REQUEST_URI "@beginsWith /api/" "id:9003,phase:1,pass,nolog,ctl:ruleRemoveByTag=attack-xss"`,
  },
  {
    id: "blockUserAgent",
    snippet: `SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:9002,phase:1,deny,status:403,log"`,
  },
] as const;
