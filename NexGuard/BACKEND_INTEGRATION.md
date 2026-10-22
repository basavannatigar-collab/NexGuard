
```json
{
  "scan_id": "server-generated-id",
  "status": "threat_detected | no_detection | inconclusive | scan_error",
  "created_at": "ISO-8601 timestamp",
  "target": {
    "name": "original filename or URL host",
    "type": "actual file type / URL / APK",
    "size_bytes": 1234,
    "sha256": "hex digest or null"
  },
  "risk": {
    "level": "LOW | MEDIUM | HIGH | CRITICAL | UNDETERMINED",
    "score": null,
    "score_explanation": "Explain rule-based score; do not present it as probability"
  },
  "findings": [
    {
      "engine": "configured engine name/version",
      "name": "exact returned signature/family or unknown",
      "category": "trojan | ransomware | spyware | phishing | suspicious | unknown",
      "severity": "engine finding severity",
      "evidence": "matched rule/signature/indicator",
      "explanation": "plain-language description grounded in evidence",
      "potential_harm": "possible harm associated with this type",
      "recommendation": "safe next step"
    }
  ],
  "summary": "Plain-language summary grounded in findings",
  "limitations": ["No detection is not proof of safety"]
}
```

