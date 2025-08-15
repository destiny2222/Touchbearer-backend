require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const con = require('./database');

app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/protected', require('./routes/protected'));
app.use('/api/notreallysuperadmin', require('./routes/superAdmin'));
app.use('/api/event', require('./routes/event'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/expenses', require('./routes/expenses'));

app.get('/', (req, res) => {
    res.json({ message: 'Hello World!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Node server running on port ${PORT}`);
});
