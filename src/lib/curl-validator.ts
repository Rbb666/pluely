import curl2Json from "@bany/curl-to-json";

export interface CurlValidationResult {
  isValid: boolean;
  message?: string;
}

export const validateCurl = (
  curl: string,
  requiredVariables: string[]
): CurlValidationResult => {
  if (!curl.trim().startsWith("curl")) {
    return {
      isValid: false,
      message: "命令必须以 curl 开头。",
    };
  }

  try {
    curl2Json(curl);
  } catch (error) {
    return {
      isValid: false,
      message:
        "cURL 命令语法无效，请检查命令格式和拼写。",
    };
  }

  const missingVariables = requiredVariables.filter(
    (variable) => !curl.includes(`{{${variable}}}`)
  );

  if (missingVariables.length > 0) {
    const missingVarsString = missingVariables
      .map((v) => `{{${v}}}`)
      .join(", ");
    return {
      isValid: false,
      message: `缺少以下必填变量：${missingVarsString}。`,
    };
  }

  return { isValid: true };
};
