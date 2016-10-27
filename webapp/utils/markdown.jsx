// Copyright (c) 2015 Mattermost, Inc. All Rights Reserved.
// See License.txt for license information.

import * as TextFormatting from './text_formatting.jsx';
import * as SyntaxHighlighting from './syntax_highlighting.jsx';

import marked from 'marked';
import katex from 'katex';

function markdownImageLoaded(image) {
    image.style.height = 'auto';
}
global.markdownImageLoaded = markdownImageLoaded;

class MattermostMarkdownRenderer extends marked.Renderer {
    constructor(options, formattingOptions = {}) {
        super(options);

        this.heading = this.heading.bind(this);
        this.paragraph = this.paragraph.bind(this);
        this.text = this.text.bind(this);

        this.formattingOptions = formattingOptions;
    }

    code(code, language) {
        let usedLanguage = language || '';
        usedLanguage = usedLanguage.toLowerCase();

        if (usedLanguage === 'tex' || usedLanguage === 'latex') {
            try {
                const html = katex.renderToString(code, {throwOnError: false, displayMode: true});

                return '<div class="post-body--code tex">' + html + '</div>';
            } catch (e) {
                // fall through if latex parsing fails and handle below
            }
        }

        // treat html as xml to prevent injection attacks
        if (usedLanguage === 'html') {
            usedLanguage = 'xml';
        }

        let className = 'post-code';
        if (!usedLanguage) {
            className += ' post-code--wrap';
        }

        let header = '';
        if (SyntaxHighlighting.canHighlight(usedLanguage)) {
            header = (
                '<span class="post-code__language">' +
                    SyntaxHighlighting.getLanguageName(language) +
                '</span>'
            );
        }

        // if we have to apply syntax highlighting AND highlighting of search terms, create two copies
        // of the code block, one with syntax highlighting applied and another with invisible text, but
        // search term highlighting and overlap them
        const content = SyntaxHighlighting.highlight(usedLanguage, code);
        let searchedContent = '';

        if (this.formattingOptions.searchPatterns) {
            const tokens = new Map();

            let searched = TextFormatting.sanitizeHtml(code);
            searched = TextFormatting.highlightSearchTerms(searched, tokens, this.formattingOptions.searchPatterns);

            if (tokens.size > 0) {
                searched = TextFormatting.replaceTokens(searched, tokens);

                searchedContent = (
                    '<div class="post-code__search-highlighting">' +
                        searched +
                    '</div>'
                );
            }
        }

        return (
            '<div class="' + className + '">' +
                header +
                '<code class="hljs">' +
                    searchedContent +
                    content +
                '</code>' +
            '</div>'
        );
    }

    codespan(text) {
        let output = text;

        if (this.formattingOptions.searchPatterns) {
            const tokens = new Map();
            output = TextFormatting.highlightSearchTerms(output, tokens, this.formattingOptions.searchPatterns);
            output = TextFormatting.replaceTokens(output, tokens);
        }

        return (
            '<span class="codespan__pre-wrap">' +
                '<code>' +
                    output +
                '</code>' +
            '</span>'
        );
    }

    br() {
        if (this.formattingOptions.singleline) {
            return ' ';
        }

        return super.br();
    }

    image(href, title, text) {
        let out = '<img src="' + href + '" alt="' + text + '"';
        if (title) {
            out += ' title="' + title + '"';
        }
        out += ' onload="window.markdownImageLoaded(this)" onerror="window.markdownImageLoaded(this)" class="markdown-inline-img"';
        out += this.options.xhtml ? '/>' : '>';
        return out;
    }

    heading(text, level, raw) {
        const id = `${this.options.headerPrefix}${raw.toLowerCase().replace(/[^\w]+/g, '-')}`;
        return `<h${level} id="${id}" class="markdown__heading">${text}</h${level}>`;
    }

    link(href, title, text) {
        let outHref = href;

        try {
            const unescaped = decodeURIComponent(unescape(href)).replace(/[^\w:]/g, '').toLowerCase();

            if (unescaped.indexOf('javascript:') === 0 || unescaped.indexOf('vbscript:') === 0 || unescaped.indexOf('data:') === 0) { // eslint-disable-line no-script-url
                return text;
            }
        } catch (e) {
            return text;
        }

        if (!(/[a-z+.-]+:/i).test(outHref)) {
            outHref = `http://${outHref}`;
        }

        let output = '<a class="theme markdown__link';

        if (this.formattingOptions.searchPatterns) {
            for (const pattern of this.formattingOptions.searchPatterns) {
                if (pattern.test(href)) {
                    output += ' search-highlight';
                    break;
                }
            }
        }

        output += '" href="' + outHref + '" rel="noreferrer"';

        // special case for channel links and permalinks that are inside the app
        if (this.formattingOptions.siteURL && new RegExp('^' + TextFormatting.escapeRegex(this.formattingOptions.siteURL) + '\\/[^\\/]+\\/(pl|channels)\\/').test(outHref)) {
            output += ' data-link="' + outHref.substring(this.formattingOptions.siteURL) + '"';
        } else {
            output += ' target="_blank"';
        }

        if (title) {
            output += ' title="' + title + '"';
        }

        // remove any links added to the text by hashtag or mention parsing since they'll break this link
        output += '>' + text.replace(/<\/?a[^>]*>/g, '') + '</a>';

        return output;
    }

    paragraph(text) {
        if (this.formattingOptions.singleline) {
            return `<p class="markdown__paragraph-inline">${text}</p>`;
        }

        return super.paragraph(text);
    }

    table(header, body) {
        return `<div class="table-responsive"><table class="markdown__table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    }

    listitem(text, bullet) {
        const taskListReg = /^\[([ |xX])\] /;
        const isTaskList = taskListReg.exec(text);

        if (isTaskList) {
            return `<li class="list-item--task-list">${'<input type="checkbox" disabled="disabled" ' + (isTaskList[1] === ' ' ? '' : 'checked="checked" ') + '/> '}${text.replace(taskListReg, '')}</li>`;
        }

        if (/^\d+.$/.test(bullet)) {
            // this is a numbered list item so override the numbering
            return `<li value="${parseInt(bullet, 10)}">${text}</li>`;
        }

        return `<li>${text}</li>`;
    }

    text(txt) {
        return TextFormatting.doFormatText(txt, this.formattingOptions);
    }
}

export function format(text, options = {}) {
    const markdownOptions = {
        renderer: new MattermostMarkdownRenderer(null, options),
        sanitize: true,
        gfm: true,
        tables: true
    };

    var pre = preprocessLatex(text);
    console.log(pre);
    console.log(pre.text);

    text = marked(pre.text, markdownOptions);

    if(pre.latex.length) {
        text = postprocessLatex(text, pre.latex);
    }

    console.log(text);
    return text;
}

// Latex helper functions

function findLatex(text) {
    var regex = /(^|[^\\])(\\\\)*\\\(((.|\n)*?[^\\]|)(\\\\)*?\\\)|(^|[^\\])(\\\\)*\\\[((.|\n)*?[^\\]|)(\\\\)*?\\\]/g;


    var latexList = [];
    var display;
    var match;

    while(match = regex.exec(text)) {
        // find the real begin (skip possibly leading '\')
        var start = match.index;
        var stop = match.index + match[0].length;

        while(text[start] != "\\" || (text[start+1] != "(" && text[start+1] != "[") ) {
            start++;
        }

        if(text[start+1] == "(") display = false;
        else display = true;

        latexList.push({start: start, stop: stop, display: display});
    }

    return latexList
}

function findCode(text) {
    var fences = /(?:^|\n) *(`{3,}|~{3,})[ \.]*(?:\S+)? *\n(?:[\s\S]*?)\s*\1 *(?:\n+|$)/g;
    var codeblock = /(?:( *\n){2})( {4}[^\n]+\n*)+/g;
    var code = /(`+)\s*([\s\S]*?[^`])\s*\1(?!`)/g;
    var has_paragraph = /\n *\n/g;

    var codeList = [];
    var match;

    while(match = fences.exec(text)) {
        codeList.push({start: match.index, stop: match.index + match[0].length})
    }

    while(match = codeblock.exec(text)) {
        codeList.push({start: match.index, stop: match.index + match[0].length})
    }

    while(match = code.exec(text)) {
        if(!has_paragraph.exec(match[0])) {
            codeList.push({start: match.index, stop: match.index + match[0].length})
        }
    }

    return codeList;
}

function hasOverlap(start, stop, list) {
    console.log("checking for overlap", start, stop, list);
    for(var i = 0; i < list.length; i++) {
        console.log(list[i].start, list[i].stop);
        if(start >= list[i].stop || stop <= list[i].start) continue;
        else {
             console.log("has overlap");
             return true;
        }
    }
    return false;
}

function makeRandomString(length) {
    var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    var randstr = "";

    for(var i = 0; i < length; i++) {
        var j = Math.floor(Math.random() * chars.length);
        randstr += chars[j]
    }

    return randstr;
}

function preprocessLatex(text) {

    text = text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/\u00a0/g, ' ')
    .replace(/\u2424/g, '\n');

    var latexList = findLatex(text);

    if(latexList.length == 0) return {text: text, latex: []};

    var codeList = findCode(text);

    var latex = []
    var finaltext = text.substring(0, latexList[0].start);

    for(var i = 0; i < latexList.length; i++) {
        var start, end;

        if(i < latexList.length - 1) end = latexList[i+1].start;
        else end = text.length;

        if(!hasOverlap(latexList[i].start, latexList[i].stop, codeList)) {
            start = latexList[i].stop;

            var id = makeRandomString(32);
            finaltext += id;

            latex.push({id: id,
                tex: text.substring(latexList[i].start, latexList[i].stop),
                display: latexList[i].display})
        }
        else {
             start = latexList[i].start;
        }
        finaltext += text.substring(start, end);

    }

    return {text: finaltext, latex: latex};
}

function postprocessLatex(text, latex) {
    console.log(text);
    for(var i = 0; i < latex.length; i++) {

        // check if Latex ended up in a html tag (link or image - it's easier
        // to check here than in the preprocessing)
        var regex = new RegExp("<(a|img)[^>]*?" + latex[i].id + "[^>]*?>")
        if( regex.exec(text) ) {
            var latexString;
            text = text.replace(latex[i].id, latex[i].tex);
            continue;
        }

        var html;
        var texString = latex[i].tex.substring(2, latex[i].tex.length - 2);

        try {
            html = katex.renderToString(texString,
                  {throwOnError: false, displayMode: latex[i].display});
        } catch(error) {
            html = "<code>" + error.message + "</code>";
        }

        if(latex[i].display) {
             // remove possible trailing whitespace after displayed
             // equation. Also, remove one linebreak if present
             // (already taken care by the katex css)
             var regex = new RegExp(latex[i].id + " *\n?");
             text = text.replace(regex, html);
        }
        else {
            text = text.replace(latex[i].id, html);
        }
    }
    return text;
}

// Marked helper functions that should probably just be exported

function unescape(html) {
    return html.replace(/&([#\w]+);/g, (_, m) => {
        const n = m.toLowerCase();
        if (n === 'colon') {
            return ':';
        } else if (n.charAt(0) === '#') {
            return n.charAt(1) === 'x' ?
                String.fromCharCode(parseInt(n.substring(2), 16)) :
                String.fromCharCode(Number(n.substring(1)));
        }
        return '';
    });
}
