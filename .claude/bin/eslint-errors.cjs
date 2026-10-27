module.exports = (results) =>
  results
    .flatMap((result) =>
      result.messages
        .filter((message) => message.severity === 2)
        .map(
          (message) =>
            `${result.filePath}:${message.line ?? 0}:${message.column ?? 0}: error ${message.message.split("\n")[0]} (${message.ruleId ?? "fatal"})`,
        ),
    )
    .join("\n");
