import React from 'react';

const Presetbox = ({ disabled, value, name, presetValue, imgsrc, text, applyState, changepreset }) => {

    return (
        <label>
            <input disabled={disabled} className='presets' type="radio" name={name} value={value} checked={(presetValue === value)} onChange={changepreset} />
            <img className="w-100 quick-img" src={imgsrc} alt={text} />
            <h6 className='mt-2'>{text}</h6>
            {/* <p style={{ color: 'red' }} className={applyState === applyValue ? 'd-contents' : 'd-contents opacity-0'}>Click Apply to Confirm</p> */}
        </label>
    )
}

export default Presetbox;