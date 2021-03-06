// jshint esversion: 6

var alexa = require('alexa-app');
var app = new alexa.app('quizforamerica');
var quiz = require('./quiz');
app.db = require('./db/mock-db');

function getDatabase() {
    return app.db;
}

// don't let alexa-app swallow the error
app.error = function(e, request, response) {
    console.log(e);
    throw e;
};

app.card = function(current) {
    console.log('createCard: current=', current);
    // current: {'3': 'A', '4': 'false'}
    var card = {
        type: 'Simple',
        title: 'Quiz results'
    };
    var ids = Object.keys(current);
    if (!ids.length) {
        card.content = 'No results for this session.';
        return card;
    }
    var content = 'You got '+quiz.getScore(current)+' of '+ids.length;
    content += ids.length === 1 ? ' question' : 'questions';
    content += ' correct.\n';
    Object.keys(current).forEach((q) => {
        var question = quiz.getQuestion(q);
        var answer = current[q];
        var isCorrect = question.isCorrect(answer);
        var symbol = isCorrect ? '✔' : '✗';
        content += '\n'+symbol+' '+question.q.question+'\nAnswer: ';
        if (question.isBoolean()) {
            content += question.q.answer.toLowerCase();
        } else {
            content += question.q.answers[question.q.answer];
        }
        content += '\n'+question.q.explanation+'\n';
    });
    content += '\nContent created by volunteers with DevProgress http://devprogress.us';
    card.content = content;
    return card;
};

app.startQuiz = function(response, used) {
    var say = ['<s>First question:</s>'];
    // set current list of questions to empty
    response.session('current', '{}');
    var q = quiz.getNextQuestion(used);
    if (q) {
        say.push(q.questionAndAnswers());
        response.session('q', q.id);
        response.shouldEndSession(false, 'What do you think? Is it '+q.choices()+'?');
    } else {
        say.push("That's all the questions I have for now.  Remember to vote on November eighth.");
    }
    return say;
};

app.launch(function(request, response) {
    console.log('launch');
    app.db.loadSession(request.userId).then((savedSession) => {
        var say = [];
        var used = [];
        // copy saved session into current session
        var session = savedSession || {};
        console.log('session=', session);
        if (session) {
            var all = JSON.parse(session.all || '{}');
            used = Object.keys(all);
            Object.keys(session).forEach((key) => {
                response.session(key, savedSession[key]);
            });
        }
        say.push('<s>Welcome to quiz for America. <break strength="medium" /></s>');
        if (!savedSession) {
            say.push("<s>I'll ask a multiple choice question.</s>");
            say.push('<s>Say the letter matching your answer, or say repeat <break strength="medium" /> to hear the question again.</s>');
            say.push('<s>Each quiz has ten questions.</s>');
            say.push('Say stop <break strength="medium" /> to end the quiz early.</s>');
        }
        say = say.concat(app.startQuiz(response, used));
        response.say(say.join('\n'));
        response.send();
    });
    return false;  // wait for promise to resolve
});

app.intent('AMAZON.HelpIntent', function(request, response) {
    response.say('Say repeat to hear the question again, or stop to end.');
    response.shouldEndSession(false);
});

app.intent('AMAZON.StopIntent', function(request, response) {
    var current = JSON.parse(request.session('current') || '{}');
    var score = quiz.getScore(current);
    var say = ['Thanks for playing quiz for America. '];
    if (score) {
        say.push('You got '+score+' questions correct. Check your Alexa app for detailed results.');
    }
    say.push('Remember to vote on November eighth.');
    response.card(app.card(current));
    response.say(say.join('\n'));
});

app.intent('CardIntent', function(request, response) {
    response.card(app.card(JSON.parse(request.session('current') || '{}')));
    response.say('Your results have been sent to the Alexa app.');
});

app.intent('RepeatIntent', function(request, response) {
    var q = quiz.getQuestion(request.session('q'));
    response.shouldEndSession(false, 'What do you think? Is it '+q.choices()+'?');
    response.say(q.questionAndAnswers());
});

app.intent('AnotherIntent', function(request, response) {
    var all = JSON.parse(request.session('all') || '{}');
    var say = ["<s>Ok. Let's start another quiz. <break strength=\"medium\" /></s>"];
    say = say.concat(app.startQuiz(response, Object.keys(all)));
    response.say(say.join('\n'));
});

app.intent('AnswerIntent',
    {
        // A B C true false
        'slots': { 'ANSWER': 'ANSWERS' },
        'utterances': [
            '{-|ANSWER}'
        ]
    },

    function(request, response) {
        var session = request.sessionDetails.attributes;
        // {'1': 'A', '2': 'false'}
        var all = JSON.parse(request.session('all') || '{}');
        var current = JSON.parse(request.session('current') || '{}');
        var used = Object.keys(all);
        var currentQuestionId = request.session('q');
        console.log('answer question='+currentQuestionId+' session=', session);
        var say = [];
        var q = currentQuestionId ? quiz.getQuestion(currentQuestionId) : null;
        var score = quiz.getScore(JSON.parse(request.session('current') || '{}'));
        // found question in session; check answer
        if (q) {
            var answer = request.slot('ANSWER');
            if (answer === "I don't know") {
                answer = '';
            } else {
                var first = answer.slice(0, 1).toUpperCase();
                if (q.isBoolean()) {
                    // TRUE or FALSE
                    answer = first === 'T' ? 'TRUE' : 'FALSE';
                } else {
                    // one uppercase letter
                    answer = first;
                }
            }
            console.log('answer='+answer);
            app.db.logAnswer(currentQuestionId, answer);
            var sayAnswer = q.answer(answer);
            if (q.isCorrect(answer)) {
                say.push("<s>That's correct!</s>");
                score += 1;
            } else {
                say.push('<s>The correct answer is '+q.answerText()+'.</s>');
            }
            say.push(q.explanation());
            // save question and answer to current and all questions
            current[currentQuestionId] = answer;
            all[currentQuestionId] = answer;
        }
        session.current = JSON.stringify(current);
        session.all = JSON.stringify(all);
        // if 10 questions, stop and send results
        var numQuestions = Object.keys(current).length;
        console.log('questions=', numQuestions);
        if (numQuestions === 10) {
            response.say("<s>Congratulations! You've answered ten questions. "+
                'Check your Alexa app for detailed results. '+
                'To start another quiz, say another.'+
                "Don't forget to vote on November eighth.</s>");
            response.card(app.card(current));
        } else {
            // get next question
            var next = quiz.getNextQuestion(Object.keys(all));
            if (next) {
                say.push('<s>Question '+(numQuestions+1)+'. <break strength="x-strong" /></s>');
                say.push(next.questionAndAnswers());
                session.q = next.id;
                response.shouldEndSession(false, 'What do you think? Is it '+next.choices()+'?');
            } else {
                say.push("That's all the questions I have for now. You got "+score+
                    " correct. Remember to vote on November eighth.");
                response.card(app.card(current));
            }
        }
        Object.keys(session).forEach((key) => {
            response.session(key, session[key]);
        });
        app.db.saveSession(request.userId, session).then(() => {
            console.log('saved session');
            response.say(say.join('\n'));
            response.send();
        });
        return false;
    }
);


if (process.argv.length > 2) {
    var arg = process.argv[2];
    if (arg === '-s' || arg === '--schema') {
        console.log(app.schema());
    }
    if (arg === '-u' || arg === '--utterances') {
        console.log(app.utterances());
    }
}

module.change_code=1;
module.exports = app;
