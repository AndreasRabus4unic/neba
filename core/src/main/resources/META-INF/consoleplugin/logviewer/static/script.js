/**
 * Copyright 2013 the original author or authors.
 *
 * Licensed under the Apache License, Version 2.0 the "License";
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
$(function () {
    var KEY_ENTER = 13,
        KEY_A = 65,
        textDecoder = new TextDecoder("UTF-8"),
        tailSocket,
        tailDomNode = document.getElementById("tail"),
    // focusedViewDomNode = document.getElementById("focusedView"),
        $logfile = $("#logfile"),
        $logfiles = $logfile.children().clone(),
        $amount = $("#amount"),
        $followButton = $("#followButton"),
        $hideRotated = $("#hideRotated"),
        $hideNotMatched = $("#hideNotMatched"),
        $downloadButton = $("#downloadButton"),
        $focusOnErrorsButton = $("#focusOnErrors"),
        $focusOnErrorsCount = $("#numberOfDetectedErrors"),
        $logMatch = $("#logMatch");

    /**
     * Represents the Tail views (tail and error focused) and the
     * related operations.
     */
    var Tail = {
        /**
         * The known types of logfiles.
         */
        LogType: Object.freeze({
            ERROR: 0,
            REQUEST: 1,
            ACCESS: 2
        }),

        /**
         * The currently tailed log file type.
         */
        logType: undefined,

        /**
         * The buffered remained of a line not yet terminated.
         */
        buffer: "",

        /**
         * Whether the error focused view is active.
         */
        errorFocused: false,

        /** Show only lines matching the given regex */
        showMatchedLinesOnly: false,

        /**
         * The currently open error section, if any.
         */
        errorSection: undefined,

        /**
         * The nodes representing error sections.
         */
        errorSectionNodes: [],

        /**
         * Event listeners to be notified when an error is added or an error section is updated.
         */
        errorUpdateListeners: [],

        /**
         * Event listeners to be notified when an new error section is added.
         */
        newErrorListeners: [],

        followMode: false,

        findRegex: null,

        numberOfErrors: function () {
            // return this.errorSectionNodes.length;
            return document.getElementById("tail").getElementsByClassName("error").length;
        },

        onNewError: function (callback) {
            this.newErrorListeners.push(callback);
        },

        notifyErrorUpdateListeners: function () {
            var section = this.errorSection;
            this.errorUpdateListeners.forEach(function (listener) {
                listener(section);
            });
        },

        notifyNewErrorListeners: function () {
            var section = this.errorSection;
            this.newErrorListeners.forEach(function (listener) {
                listener(section);
            });
        },

        /**
         * Clears the tail and re-sets any associated state.
         */
        clear: function () {
            tailDomNode.innerHTML = "";
            this.buffer = "";
            this.errorSection = undefined;
            this.errorSectionNodes = [];
            if (this.errorFocused) {
                this.toggleErrorFocus();
            }
        },

        /**
         * Send meta-info about the tail process itself to the tail, e.g. a notification
         * when log file rotation occurs.
         */
        info: function (text) {
            tailDomNode.appendChild(
                document.createTextNode('\r\n ----------------- ' + text + ' ----------------- \r\n\r\n')
            );
            this.follow();
        },

        /**
         * Add a message to the tail.
         */
        add: function (text) {

            function linkRequestLog(match) {
                var link = document.createElement("a");
                link.textContent = '[' + match[2] + ']';
                tailDomNode.appendChild(document.createTextNode(match[1]));
                tailDomNode.appendChild(link);
                tailDomNode.appendChild(document.createTextNode(match[3] + '\r\n'));
                return link;
            }

            function requestStartPattern() {
                return /(.* )\[([0-9]+)]( \-> (GET|POST|PUT|HEAD|DELETE) .*)/g;
            }

            function requestEndPattern(){
                return /(.* )\[([0-9]+)]( <\- [0-9]+ .*)/g;
            }

            var lines = (this.buffer + text).split('\n');
            var re = this.findRegex;
            var replfunc = function(str) {return '<b>'+str+'</b>'} ;

            for (var i = 0; i < lines.length - 1; ++i) {
                var line = lines[i];
                var firstChar = line.charAt(0);
                /**
                 * Convert each line of text into a new DOM node. This non-normalized approach
                 * (many small text nodes instead of one large text node) has many advantages: It significantly increases performance
                 * as it allows the browser to only render the text nodes currently in view and allows to easily take single lines
                 * of text and highlight them, e.g. for highlighting errors.
                 *
                 * @type {Text}
                 */
                var textNode = document.createElement('div');
                if (re !== null) {
                    textNode.innerHTML = line.replace(re, replfunc, 'gi');
                    if (re.test(line)) {
                        textNode.classList.add("matched");
                    }
                } else {
                    textNode.innerHTML = line;
                    /*
                     if ($hideNotMatched.is(":checked")){
                     textNode.classList.add('hidden');
                     }
                     */
                }

                if (this.logType === Tail.LogType.ERROR || this.logType === undefined) {

                    // An error statement was detected before and is not yet finished
                    if (this.errorSection) {
                        // The first character is a tab or not a number -> consider it part of a stack trace.
                        if (firstChar === '\t' || (firstChar * 0) !== 0) {
                            // DEBUG: console.log("inside error block: " + line.substr(0,80));
                            // Add the node to the existing error section
                            // textNode.classList.add("error");
                            this.errorSection.appendChild(textNode);
                            this.notifyErrorUpdateListeners();
                            continue;
                        }
                        // The text is not part of the current error section -> end the error section
                        this.errorSection = undefined;
                    }

                    // An error is detected.
                    if ( (line.indexOf("*ERROR*") !== -1) || (line.indexOf("*WARN*") !== -1) ) {
                        // DEBUG: console.log("error block started: " + line.substr(0,80) );
                        this.logType = Tail.LogType.ERROR;
                        // Create a new div that will hold all elements of the logged error, including stack traces
                        this.errorSection = document.createElement("div");
                        if ((line.indexOf("*WARN*") !== -1)) {
                            this.errorSection.classList.add("warning");
                        } else {
                            this.errorSection.classList.add("error");
                        }
                        this.errorSectionNodes.push(this.errorSection);

                        // Add the newly created error section to the log view
                        tailDomNode.appendChild(this.errorSection);
                        // Add the current text to the newly created error section
                        this.errorSection.appendChild(textNode);
                        this.notifyNewErrorListeners();
                        continue;
                    }
                }

                if (this.logType === Tail.LogType.REQUEST || this.logType === undefined) {
                    var match = requestStartPattern().exec(line);
                    if (match !== null) {
                        this.logType = Tail.LogType.REQUEST;
                        var link = linkRequestLog(match);
                        link.setAttribute("href", '#r' + match[2]);
                        continue;
                    }

                    match = requestEndPattern().exec(line);
                    if (match !== null) {
                        this.logType = Tail.LogType.REQUEST;
                        linkRequestLog(match).setAttribute("name", 'r' + match[2]);
                        continue;
                    }
                }

                // Simply append the line,
                tailDomNode.appendChild(textNode);
            }

            if (lines[lines.length - 1]) {
                this.buffer = lines[lines.length - 1];
            } else {
                this.buffer = "";
            }

            this.follow();
        },

        /**
         * When follow mode is on, scroll to the bottom of the views.
         */
        follow: function () {
            this.followMode &&
            (tailDomNode.scrollTop = tailDomNode.scrollHeight);
        },

        /**
         * Whether to follow the log file additions.
         * @returns {boolean} whether follow mode is on.
         */
        toggleFollowMode: function () {
            this.followMode = !this.followMode;
            this.follow();
            return this.followMode;
        },

        /**
         * Warning: race condition, as querySelectorAll returns a non-live list of nodes.
         */
        hideLogLines: function(selector) {
            if (!selector) selector = '#tail > div.:not(.matched)';
            var tail = document.getElementById('tail');
            var divs = tail.querySelectorAll(selector);
            for ( i = 0; i < divs.length; ++i) {
                divs[i].classList.add('hidden');
                // divs[i].className += divs[i].className ? ' hidden' : 'hidden';
            }
        },
        unhideLogLines: function(selector) {
            // Cheat...
            var wrapFn = function(div) {
                div.classList.remove('hidden');
            };

            if (!selector) selector = '#tail > div.hidden';
            var tail = document.getElementById('tail');
            var divs = tail.querySelectorAll(selector);
            for ( i = 0; i < divs.length; ++i) {
                setTimeout(wrapFn, 0, divs[i]);
                // divs[i].classList.remove('hidden');
            }
        },
        /**
         * Whether to only show errors.
         * @returns {boolean} whether only show errors is on.
         */
        toggleErrorFocus: function () {
            this.errorFocused = !this.errorFocused;
            if (this.errorFocused) {
                this.hideLogLines('#tail > div:not(.error)');
            } else {
                var selector = '#tail > div.hidden:not(.error)';
                if (this.showMatchedLinesOnly) {
                    selector = '#tail > div.hidden:not(.error).matched';
                }
                this.unhideLogLines(selector);
            }
            return this.errorFocused;
        },

        // regex matched lines only or not.
        toggleMatchedFocus: function () {
            this.showMatchedLinesOnly = !this.showMatchedLinesOnly;
            if (this.showMatchedLinesOnly) {
                this.hideLogLines('#tail > div:not(.matched):not(.error)');
            } else {
                this.unhideLogLines("#tail > div.hidden:not(.error)");
            }
            // return false;
        },

        setFindRegex: function(logMatch) {
            this.findRegex = null;
            var result = true;
            try {
                if (logMatch !== null && logMatch.length > 0) {
                    this.findRegex = new RegExp(logMatch, "gi");
                }
            } catch(e) {
                result = false;
            }
            return result;
        }
    };


    /**
     * Binds the log viewer behavior to the UI elements (such as buttons) once
     * a websocket connection was successfully established.
     */
    function initUiBehavior() {
        $logfile.change(function () {
            if ($logfile.val()) {
                logfileParametersChanged();
            }
            return false;
        });

        $followButton.click(function () {
            Tail.toggleFollowMode() ? activeStyle($followButton) : inactiveStyle($followButton);
            return false;
        });

        $downloadButton.click(function () {
            window.location.href = pluginRoot + "/download";
        });

        $amount.keydown(function (event) {
            if (event.which === KEY_ENTER) {
                logfileParametersChanged();
                return false;
            }
            return true;
        });

        $logMatch.keydown(function (event) {
            if (event.which === KEY_ENTER) {
                var logMatch = $logMatch.val();
                if (false === Tail.setFindRegex(logMatch)) {
                    alert("Invalid RegEx pattern given. Will be ignored.");
                    return true;
                }
                logfileParametersChanged();
                return false;
            }
            return true;
        });

        $hideRotated.change(function () {
            toggleRotatedLogfiles();
            return false;
        });

        $focusOnErrorsButton.click(function () {
            Tail.toggleErrorFocus() ? activeStyle($focusOnErrorsButton) : inactiveStyle($focusOnErrorsButton);
            return false;
        });

        $hideNotMatched.click(function () {
            Tail.toggleMatchedFocus();
        });
    }

    function activeStyle($button) {
        $button.css("background", "palegreen").css("font-weight", "bold");
    }

    function inactiveStyle($button) {
        $button.css("background", "").css("font-weight", "");
    }

    /**
     * Creates a new websocket and initializes message and error handling.
     *
     * @returns {WebSocket}
     */
    function createSocket() {
        var socket = new WebSocket((window.location.protocol === "https" ? "wss" : "ws") + "://" + window.location.host + "/system/console/logviewer/tail");

        socket.onclose = function () {
            Tail.info("Connection to server lost. Trying to reconnect ...");
            window.setTimeout(function () {
                try {
                    tailSocket = createSocket();
                    tailSocket.onopen = function() {
                        Tail.clear();
                        tailSelectedLogFile();
                    };
                } catch (e) {
                    console && console.log(e);
                    Tail.info("Unable to open server connection: " + e.message);
                }
            }, 2000);
        };

        socket.onmessage = function (event) {
            var data = event.data;
            if (data instanceof ArrayBuffer) {
                Tail.add(textDecoder.decode(event.data));
            } else if (typeof data === 'string') {
                if ("pong" === data) {
                    return;
                }
                Tail.info(data);
            } else if (console) {
                console.error("Unsupported data format of websocket response " + data + ".");
            }
        };

        socket.binaryType = "arraybuffer";

        window.setInterval(function () {
            socket.readyState === WebSocket.OPEN &&
            socket.send("ping");
        }, 1000);

        window.onunload = function () {
            if (socket) {
                socket.onclose = undefined;
                socket.close();
            }
        };

        return socket;
    }

    /**
     * Load selected logfile from the request parameters, e.g. ?file=/my/file&amount=100
     */
    function selectLogfileAndAmountFromRequestParameters() {

        var queryString = document.location.search;
        if (!queryString) {
            return;
        }

        var opts = {};

        var requestParameterPattern = /(\?|&)([^=]+)=([^&\?]*)/g;
        while ((match = requestParameterPattern.exec(queryString)) !== null) {
            opts[match[2]] = match[3];
        }

        if (! (opts.amount && opts.file)) {
            return;
        }

        if (parseInt(opts.amount) < 0) {
            return;
        }

        $amount.val(opts.amount);

        var lm = decodeURI(opts.logMatch);
        $logMatch.val(lm);
        if (false === Tail.setFindRegex(lm)) {
            alert("Invalid RegEx pattern given. Will be ignored.");
        }

        // The log was not found in the non-rotated log files - perhaps it is in the rotated files?
        if (!selectLogFile(opts.file) && $hideRotated.is(":checked")) {
            var found;
            $logfiles.each(function (_, v) {
                if (v.value === opts.file) {
                    found = true;
                }
            });

            if (found) {
                $hideRotated.click();
                selectLogFile(opts.file);
            }
        }

        tailDomNode.innerHTML = "";
        tailSelectedLogFile();
    }

    /**
     * Re-loads the page with the selected parameters.
     */
    function logfileParametersChanged() {
        var file = $logfile.val(),
            amount = $amount.val(),
            logMatch = $logMatch.val(),
            href = document.location.href,
            queryPos = Math.max(href.indexOf("?"), href.indexOf("#")),
            endPos = queryPos === -1 ? href.length : queryPos;

        // only reload page if necessary
        if (!(file && amount && logMatch)) {
            return;
        }

        Tail.setFindRegex(logMatch);
        document.location.href = href.substr(0, endPos) + "?file=" + file + '&amount=' + amount + '&logMatch=' + encodeURI(logMatch);
    }

    /**
     * Finds the option with the given value in the logfiles dropdown and sets it to selected.
     * @returns {boolean} whether the log file was found.
     */
    function selectLogFile(file) {
        var found = false;
        $logfile.find("option").each(function (_, v) {
            if (v.value === file) {
                v.selected = true;
                found = true;
            }
        });
        return found;
    }

    /**
     * Starts tailing the selected log file.
     */
    function tailSelectedLogFile() {
        var file = $logfile.val(),
            amount = $amount.val();

        if (!(file && amount)) {
            return;
        }

        tailSocket.send("tail:" + amount + 'mb:' + file);
    }

    function adjustViewsToScreenHeight() {
        tailDomNode.style.height = (screen.height * 0.65) + "px";
    }

    function toggleRotatedLogfiles() {
        $logfile.children().remove();
        $logfile.append(
            $hideRotated.is(":checked") ? $logfiles.filter("[value$='\\.log'],[value='']") : $logfiles
        );
    }

    /**
     * Intercepts ctrl + a to create a text selection exclusively spanning the current
     * log data view.
     */
    function restrictCopyAllToLogView() {
        $(document).keydown(function (e) {
            if (e.keyCode == KEY_A && e.ctrlKey) {
                e.preventDefault();
                var range = document.createRange();
                window.getSelection().addRange(range);
            }
        });
    }

    // end of functions.

    /**
     * Show and / or update the error focus button.
     */
    Tail.onNewError(function () {
        if (Tail.numberOfErrors() === 1) {
            $focusOnErrorsCount.fadeIn();
        }
        $focusOnErrorsCount.html(Tail.numberOfErrors());
        if ($focusOnErrorsButton.inAnimation) {
            return;
        }
        $focusOnErrorsButton.inAnimation = true;
        $focusOnErrorsButton.effect("highlight", {color: "#883B26"}, 600, function () {
            $focusOnErrorsButton.inAnimation = false;
        })
    });

    adjustViewsToScreenHeight();
    toggleRotatedLogfiles();
    restrictCopyAllToLogView();

    try {
        tailSocket = createSocket();
        tailSocket.onopen = function () {
            initUiBehavior();
            selectLogfileAndAmountFromRequestParameters();
        }
    } catch (e) {
        console && console.log(e);
        Tail.info("Unable to open server connection: " + e.message);
    }

});
