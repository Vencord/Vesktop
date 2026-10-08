//! Mini Discord-markup tokenizer: turns message content into styled
//! segments. Pure and unit-tested; the UI layer maps segments to
//! `egui::TextFormat`. Deliberately a subset — images, full markdown and
//! clickable links are tracked in docs/PORT.md.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    Normal,
    Bold,
    Italic,
    Code,
    CodeBlock,
    /// `<@id>` / `<@!id>` — rendered as `@id`, resolved by the UI if known.
    Mention,
    /// `<#id>` — rendered as `#id`, resolved by the UI if known.
    ChannelName,
    /// `<:name:id>` / `<a:name:id>` — rendered as `:name:`.
    Emoji,
    Link,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub text: String,
    pub style: Style,
}

fn flush(plain: &mut String, segments: &mut Vec<Segment>) {
    if !plain.is_empty() {
        segments.push(Segment {
            text: std::mem::take(plain),
            style: Style::Normal,
        });
    }
}

/// A closing `>` for an embed-like token, only if it comes soon enough that
/// the token can plausibly be one (guards against swallowing whole messages
/// after a stray `<`).
fn plausible_close(rest: &str) -> Option<usize> {
    rest.find('>').filter(|&idx| idx <= 96)
}

pub fn tokenize(text: &str) -> Vec<Segment> {
    let mut segments: Vec<Segment> = Vec::new();
    let mut plain = String::new();
    let mut i = 0usize;

    while i < text.len() {
        let rest = &text[i..];

        if rest.starts_with("```") {
            flush(&mut plain, &mut segments);
            let after = &rest[3..];
            match after.find("```") {
                Some(end) => {
                    let mut body = &after[..end];
                    // Drop a first line that is only a language tag.
                    if let Some(nl) = body.find('\n') {
                        if body[..nl]
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '+')
                        {
                            body = &body[nl + 1..];
                        }
                    }
                    let body = body.trim_end_matches('\n');
                    if !body.is_empty() {
                        segments.push(Segment {
                            text: body.to_string(),
                            style: Style::CodeBlock,
                        });
                    }
                    i += 3 + end + 3;
                }
                None => {
                    let body = after.trim_end_matches('\n');
                    if !body.is_empty() {
                        segments.push(Segment {
                            text: body.to_string(),
                            style: Style::CodeBlock,
                        });
                    }
                    i = text.len();
                }
            }
            continue;
        }

        if rest.starts_with('`') {
            flush(&mut plain, &mut segments);
            match rest[1..].find('`') {
                Some(end) if end > 0 => {
                    segments.push(Segment {
                        text: rest[1..1 + end].to_string(),
                        style: Style::Code,
                    });
                    i += 1 + end + 1;
                }
                _ => {
                    plain.push('`');
                    i += 1;
                }
            }
            continue;
        }

        if rest.starts_with("**") {
            flush(&mut plain, &mut segments);
            match rest[2..].find("**") {
                Some(end) if end > 0 => {
                    segments.push(Segment {
                        text: rest[2..2 + end].to_string(),
                        style: Style::Bold,
                    });
                    i += 2 + end + 2;
                }
                _ => {
                    plain.push('*');
                    i += 1;
                }
            }
            continue;
        }

        if rest.starts_with('*') || rest.starts_with('_') {
            let marker = rest.as_bytes()[0] as char;
            let closer = rest[1..].find(marker).map(|idx| idx + 1);
            match closer {
                Some(end) if end > 1 && !rest[1..end].contains('\n') => {
                    flush(&mut plain, &mut segments);
                    segments.push(Segment {
                        text: rest[1..end].to_string(),
                        style: Style::Italic,
                    });
                    i += end + 1;
                }
                _ => {
                    plain.push(marker);
                    i += 1;
                }
            }
            continue;
        }

        if rest.starts_with("<@!") || rest.starts_with("<@") {
            if let Some(close) = plausible_close(rest) {
                flush(&mut plain, &mut segments);
                let id = rest[2..close].trim_start_matches('!').to_string();
                segments.push(Segment {
                    text: format!("@{id}"),
                    style: Style::Mention,
                });
                i += close + 1;
                continue;
            }
        }

        if rest.starts_with("<#") {
            if let Some(close) = plausible_close(rest) {
                flush(&mut plain, &mut segments);
                segments.push(Segment {
                    text: format!("#{}", &rest[2..close]),
                    style: Style::ChannelName,
                });
                i += close + 1;
                continue;
            }
        }

        if rest.starts_with("<:") || rest.starts_with("<a:") {
            if let Some(close) = plausible_close(rest) {
                let prefix_len = if rest.starts_with("<a:") { 3 } else { 2 };
                let inner = &rest[prefix_len..close];
                if let Some(sep) = inner.find(':') {
                    flush(&mut plain, &mut segments);
                    segments.push(Segment {
                        text: format!(":{}:", &inner[..sep]),
                        style: Style::Emoji,
                    });
                    i += close + 1;
                    continue;
                }
            }
        }

        if rest.starts_with("https://") || rest.starts_with("http://") {
            flush(&mut plain, &mut segments);
            let end = rest
                .find(|c: char| c.is_whitespace() || c == '>' || c == ')')
                .unwrap_or(rest.len());
            segments.push(Segment {
                text: rest[..end].to_string(),
                style: Style::Link,
            });
            i += end;
            continue;
        }

        let ch = rest.chars().next().expect("rest is non-empty");
        plain.push(ch);
        i += ch.len_utf8();
    }

    flush(&mut plain, &mut segments);
    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn styles(text: &str) -> Vec<(String, Style)> {
        tokenize(text)
            .into_iter()
            .map(|segment| (segment.text, segment.style))
            .collect()
    }

    #[test]
    fn plain_text_stays_plain() {
        assert_eq!(
            styles("olá mundo"),
            vec![("olá mundo".to_string(), Style::Normal)]
        );
    }

    #[test]
    fn bold_and_italic() {
        assert_eq!(
            styles("**oi** e *voce*"),
            vec![
                ("oi".to_string(), Style::Bold),
                (" e ".to_string(), Style::Normal),
                ("voce".to_string(), Style::Italic),
            ]
        );
    }

    #[test]
    fn inline_code_and_fence() {
        assert_eq!(
            styles("`cargo run`"),
            vec![("cargo run".to_string(), Style::Code)]
        );
        assert_eq!(
            styles("antes```rust\nfn main() {}\n```depois"),
            vec![
                ("antes".to_string(), Style::Normal),
                ("fn main() {}".to_string(), Style::CodeBlock),
                ("depois".to_string(), Style::Normal),
            ]
        );
    }

    #[test]
    fn unterminated_markers_stay_plain() {
        assert_eq!(
            styles("isso **nao fecha"),
            vec![
                ("isso ".to_string(), Style::Normal),
                ("**nao fecha".to_string(), Style::Normal),
            ]
        );
    }

    #[test]
    fn mention_channel_emoji_tokens() {
        assert_eq!(
            styles("oi <@!12345> ve <#98765> e <:sob:123>"),
            vec![
                ("oi ".to_string(), Style::Normal),
                ("@12345".to_string(), Style::Mention),
                (" ve ".to_string(), Style::Normal),
                ("#98765".to_string(), Style::ChannelName),
                (" e ".to_string(), Style::Normal),
                (":sob:".to_string(), Style::Emoji),
            ]
        );
    }

    #[test]
    fn links_stop_at_whitespace() {
        assert_eq!(
            styles("veja https://exemplo.com/a?b=1 fim"),
            vec![
                ("veja ".to_string(), Style::Normal),
                ("https://exemplo.com/a?b=1".to_string(), Style::Link),
                (" fim".to_string(), Style::Normal),
            ]
        );
    }
}
